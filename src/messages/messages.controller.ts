import { Controller, Get, Post, Body, UseGuards, Req, Query, Param, NotFoundException } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

import { Throttle } from '@nestjs/throttler';

@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post('send')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async sendMessage(@Req() req: any, @Body() body: { text: string; studentId?: string; tutorId?: string }) {
    const userId = req.user.userId;
    const role = req.user.role;

    if (role === 'student' || role === 'parent') {
      // Student/parent → a specific assigned tutor (tutorId), or auto-routed if omitted
      return this.messagesService.sendStudentQuery(userId, body.text, body.tutorId);
    } else if (role === 'tutor' && body.studentId) {
      // If tutor, send to specific student
      return this.messagesService.sendTutorReply(userId, body.studentId, body.text);
    }
  }

  // Tutors a student can message (trial tutor + active enrollments + booked tutors)
  @Get('my-tutors')
  async getMyTutors(@Req() req: any) {
    return this.messagesService.getMyTutors(req.user.userId);
  }

  @Get()
  async getMessages(
    @Req() req: any,
    @Query('studentId') studentId?: string,
    @Query('tutorId') tutorId?: string,
  ) {
    // For a tutor the "other party" is a student; for a student it's a tutor.
    return this.messagesService.getMessages(req.user.userId, studentId ?? tutorId);
  }

  @Get('conversations')
  async getConversations(@Req() req: any) {
    return this.messagesService.getConversations(req.user.userId);
  }

  @Get('unread')
  async getUnreadCount(@Req() req: any) {
    const count = await this.messagesService.getUnreadCount(req.user.userId);
    return { count };
  }

  // Student marks their thread with a specific tutor read (scoped by tutorId).
  // Declared before the :otherId param route so /read/tutor matches here.
  @Post('read/tutor')
  async markTutorThreadRead(@Req() req: any, @Body() body: { tutorId?: string }) {
    await this.messagesService.markAsRead(req.user.userId, body?.tutorId);
    return { success: true };
  }

  @Post('read/:otherId')
  async markAsRead(@Req() req: any, @Param('otherId') otherId: string) {
    await this.messagesService.markAsRead(req.user.userId, otherId);
    return { success: true };
  }
}
