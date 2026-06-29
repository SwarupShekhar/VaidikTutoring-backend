import { Controller, Post, Headers, Req, Res, HttpStatus, Logger, UnauthorizedException } from '@nestjs/common';
import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Controller('webhooks/zoom')
export class ZoomWebhookController {
  private readonly logger = new Logger(ZoomWebhookController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async handleZoomWebhook(@Headers() headers: any, @Req() req: Request, @Res() res: Response) {
    const signature = headers['x-zm-signature'];
    const timestamp = headers['x-zm-request-timestamp'];
    const secretToken = process.env.ZOOM_SECRET_TOKEN;
    const body = req.body;
    const rawBody = (req as any).rawBody || JSON.stringify(body);

    if (!secretToken) {
      this.logger.error('ZOOM_SECRET_TOKEN is not configured.');
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).send();
    }

    // URL Validation Event
    if (body?.event === 'endpoint.url_validation') {
      const plainToken = body.payload?.plainToken;
      if (!plainToken) return res.status(HttpStatus.BAD_REQUEST).send();
      const hashForValidate = crypto.createHmac('sha256', secretToken).update(plainToken).digest('hex');
      return res.status(HttpStatus.OK).json({
        plainToken: plainToken,
        encryptedToken: hashForValidate
      });
    }

    // Signature Verification for all other events
    if (!signature || !timestamp) {
      this.logger.error('Missing Zoom webhook headers');
      throw new UnauthorizedException('Missing Zoom webhook headers');
    }

    const message = `v0:${timestamp}:${rawBody}`;
    const hashForVerify = crypto.createHmac('sha256', secretToken).update(message).digest('hex');
    const signatureStr = `v0=${hashForVerify}`;

    if (signature !== signatureStr) {
      this.logger.error('Invalid Zoom Webhook signature');
      throw new UnauthorizedException('Invalid signature');
    }

    this.logger.log(`Received Zoom webhook event: ${body?.event}`);

    // Handle Participant Joined / Left
    if (body?.event === 'meeting.participant_joined' || body?.event === 'meeting.participant_left') {
      const meetingId = body.payload?.object?.id?.toString();
      const participantEmail = body.payload?.object?.participant?.email;

      if (!meetingId || !participantEmail) {
        return res.status(HttpStatus.OK).send();
      }

      // Find the session associated with this zoom_meeting_id
      const session = await this.prisma.sessions.findFirst({
        where: { zoom_meeting_id: meetingId },
        orderBy: { created_at: 'desc' }
      });

      if (!session) {
        this.logger.warn(`No session found for Zoom meeting ID: ${meetingId}`);
        return res.status(HttpStatus.OK).send();
      }

      // Find user by email
      const user = await this.prisma.users.findUnique({
        where: { email: participantEmail }
      });

      if (user) {
        // Find the student record for this user
        const student = await this.prisma.students.findFirst({
          where: { user_id: user.id }
        });

        if (student) {
          // Record attendance
          const joined = body.event === 'meeting.participant_joined';
          
          await this.prisma.attendance.upsert({
            where: {
              sessionId_studentId: {
                sessionId: session.id,
                studentId: student.id
              }
            },
            create: {
              sessionId: session.id,
              studentId: student.id,
              present: joined,
              joinedAt: joined ? new Date() : null,
              leftAt: joined ? null : new Date()
            },
            update: {
              present: joined,
              joinedAt: joined ? new Date() : undefined,
              leftAt: joined ? null : new Date()
            }
          });
          
          this.logger.log(`Marked attendance for student ${student.id} in session ${session.id} (joined: ${joined})`);
        }
      }
    }

    return res.status(HttpStatus.OK).send();
  }
}
