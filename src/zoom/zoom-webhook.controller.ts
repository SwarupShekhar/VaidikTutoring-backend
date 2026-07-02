import {
  Controller,
  Post,
  Headers,
  Req,
  Res,
  HttpStatus,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ZoomService } from './zoom.service';

// Replay-protection window: reject events whose timestamp is more than 5 minutes
// away from now (in either direction). Matches Zoom's own recommended tolerance.
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 300_000 ms

@Controller('webhooks/zoom')
export class ZoomWebhookController {
  private readonly logger = new Logger(ZoomWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly zoomService: ZoomService
  ) {}

  @Post()
  async handleZoomWebhook(@Headers() headers: any, @Req() req: Request, @Res() res: Response) {
    const signature = headers['x-zm-signature'];
    const timestamp = headers['x-zm-request-timestamp'];
    const secretToken = process.env.ZOOM_SECRET_TOKEN;
    const body = req.body;

    if (!secretToken) {
      this.logger.error('ZOOM_SECRET_TOKEN is not configured.');
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).send();
    }

    // URL Validation Event — signed over plainToken only, no rawBody needed.
    if (body?.event === 'endpoint.url_validation') {
      const plainToken = body.payload?.plainToken;
      if (!plainToken) return res.status(HttpStatus.BAD_REQUEST).send();
      const hashForValidate = crypto
        .createHmac('sha256', secretToken)
        .update(plainToken)
        .digest('hex');
      return res.status(HttpStatus.OK).json({
        plainToken: plainToken,
        encryptedToken: hashForValidate,
      });
    }

    // Signature Verification for all other events
    if (!signature || !timestamp) {
      this.logger.error('Missing Zoom webhook headers');
      throw new UnauthorizedException('Missing Zoom webhook headers');
    }

    // The raw request bytes are captured in main.ts via express.json({ verify }).
    // We MUST sign over the exact bytes Zoom sent — a re-serialized
    // JSON.stringify(body) is not guaranteed to byte-match (key order, spacing,
    // unicode escaping), so it would fail verification. If rawBody is missing we
    // cannot validate the signature and must reject rather than guess.
    const rawBody = (req as any).rawBody;
    if (typeof rawBody !== 'string' || rawBody.length === 0) {
      this.logger.error('Zoom webhook raw body missing — cannot verify signature');
      return res.status(HttpStatus.BAD_REQUEST).send();
    }

    // Replay protection: reject stale/future timestamps.
    // Zoom sends x-zm-request-timestamp as an epoch in MILLISECONDS. We normalize
    // defensively: if the value is small enough to be a seconds-epoch (< 1e12),
    // upconvert it to ms so the staleness window is correct regardless of unit.
    const tsNum = Number(timestamp);
    if (!Number.isFinite(tsNum)) {
      this.logger.error('Zoom webhook timestamp is not a number');
      throw new UnauthorizedException('Invalid timestamp');
    }
    const tsMs = tsNum < 1e12 ? tsNum * 1000 : tsNum;
    if (Math.abs(Date.now() - tsMs) > TIMESTAMP_TOLERANCE_MS) {
      this.logger.error('Zoom webhook timestamp outside allowed window (replay protection)');
      throw new UnauthorizedException('Stale timestamp');
    }

    const message = `v0:${timestamp}:${rawBody}`;
    const hashForVerify = crypto.createHmac('sha256', secretToken).update(message).digest('hex');
    const signatureStr = `v0=${hashForVerify}`;

    // Constant-time compare. timingSafeEqual throws on unequal-length buffers, so
    // guard the length first and treat any mismatch as unauthorized.
    const sigBuf = Buffer.from(String(signature));
    const expectedBuf = Buffer.from(signatureStr);
    if (
      sigBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expectedBuf)
    ) {
      this.logger.error('Invalid Zoom Webhook signature');
      throw new UnauthorizedException('Invalid signature');
    }

    this.logger.log(`Received Zoom webhook event: ${body?.event}`);

    // Handle Participant Joined / Left
    if (
      body?.event === 'meeting.participant_joined' ||
      body?.event === 'meeting.participant_left'
    ) {
      const meetingId = body.payload?.object?.id?.toString();
      const participantEmail = body.payload?.object?.participant?.email;

      // NOTE (limitation): attendance is only recorded when the Zoom
      // participant's email EXACTLY matches a users.email row. Guest joins with
      // no email, or participants who joined under a different email than their
      // StudyHours account, are intentionally skipped (we cannot map them to a
      // student safely). This mirrors the email-keyed lookup below.
      if (!meetingId || !participantEmail) {
        return res.status(HttpStatus.OK).send();
      }

      // Find the session associated with this zoom_meeting_id
      const session = await this.prisma.sessions.findFirst({
        where: { zoom_meeting_id: meetingId },
        orderBy: { created_at: 'desc' },
      });

      if (!session) {
        this.logger.warn(`No session found for Zoom meeting ID: ${meetingId}`);
        return res.status(HttpStatus.OK).send();
      }

      // Find user by email (exact match only — see limitation note above).
      const user = await this.prisma.users.findUnique({
        where: { email: participantEmail },
      });

      if (user) {
        // Find the student record for this user
        const student = await this.prisma.students.findFirst({
          where: { user_id: user.id },
        });

        if (student) {
          const joined = body.event === 'meeting.participant_joined';

          if (joined) {
            await this.markStudentPresent(session.id, student.id);
          } else {
            await this.markStudentLeft(session.id, student.id);
          }

          this.logger.log(
            `Marked attendance for student ${student.id} in session ${session.id} (joined: ${joined})`,
          );
        }
      }
    }

    // Handle Recording Completed
    if (body?.event === 'recording.completed') {
      const payload = body?.payload?.object;
      if (payload) {
        const meetingId = payload.id?.toString();
        const recordingFiles = payload.recording_files || [];
        
        // Find the MP4 recording file
        const mp4File = recordingFiles.find((f: any) => f.file_type === 'MP4');
        
        if (meetingId && mp4File && mp4File.download_url) {
          // Process asynchronously so we can return 200 OK immediately
          this.zoomService.processRecordingWebhook(
            meetingId, 
            mp4File.download_url, 
            mp4File.file_size,
            payload.duration // The meeting duration, or could be recording duration
          ).catch(err => {
            this.logger.error(`Error in async processRecordingWebhook: ${err.message}`);
          });
        }
      }
    }

    return res.status(HttpStatus.OK).send();
  }

  /**
   * Inline equivalent of SessionsService.markStudentPresent — reimplemented here
   * because wiring SessionsService into ZoomWebhookController would require
   * editing zoom.module.ts (importing SessionsModule), which is out of scope.
   * Keeps the open-interval semantics identical to the socket attendance model:
   * set present=true, clear leftAt, and only (re)anchor joinedAt when there is no
   * interval already open (so an in-progress interval keeps its original anchor).
   */
  private async markStudentPresent(sessionId: string, studentId: string) {
    const existing = await this.prisma.attendance.findUnique({
      where: { sessionId_studentId: { sessionId, studentId } },
    });

    const intervalIsOpen =
      !!existing && existing.joinedAt !== null && existing.leftAt === null;
    const openAnchor = intervalIsOpen ? existing!.joinedAt : new Date();

    return this.prisma.attendance.upsert({
      where: { sessionId_studentId: { sessionId, studentId } },
      create: {
        sessionId,
        studentId,
        present: true,
        joinedAt: new Date(),
        leftAt: null,
      },
      update: {
        present: true,
        joinedAt: openAnchor,
        leftAt: null,
      },
    });
  }

  /**
   * Inline equivalent of SessionsService.markStudentLeft. Sets leftAt=now and
   * ACCUMULATES minutesAttended by adding the just-ended interval (now-joinedAt).
   * Guards against a null joinedAt and clock skew (never negative/NaN), and is
   * idempotent: if the interval is already closed (leftAt set) it does not
   * accumulate again. No-op if no attendance row exists yet.
   */
  private async markStudentLeft(sessionId: string, studentId: string) {
    const existing = await this.prisma.attendance.findUnique({
      where: { sessionId_studentId: { sessionId, studentId } },
    });

    if (!existing) {
      return null;
    }

    // Idempotency guard — interval already closed, don't double-count.
    if (existing.leftAt !== null) {
      return existing;
    }

    const now = new Date();

    let intervalMinutes = 0;
    if (existing.joinedAt) {
      const deltaMs = now.getTime() - new Date(existing.joinedAt).getTime();
      if (Number.isFinite(deltaMs) && deltaMs > 0) {
        intervalMinutes = Math.round(deltaMs / 60000);
      }
    }

    const accumulated = (existing.minutesAttended ?? 0) + intervalMinutes;

    return this.prisma.attendance.update({
      where: { sessionId_studentId: { sessionId, studentId } },
      data: {
        leftAt: now,
        minutesAttended: accumulated,
      },
    });
  }
}
