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
  async sendMessage(@Req() req: any, @Body() body: { text: string; studentId?: string }) {
    const userId = req.user.userId;
    const role = req.user.role;

    if (role === 'student' || role === 'parent') {
      // If student/parent, send to their assigned tutor
      return this.messagesService.sendStudentQuery(userId, body.text);
    } else if (role === 'tutor' && body.studentId) {
      // If tutor, send to specific student
      return this.messagesService.sendTutorReply(userId, body.studentId, body.text);
    }
  }

  @Get()
  async getMessages(@Req() req: any, @Query('studentId') studentId?: string) {
    return this.messagesService.getMessages(req.user.userId, studentId);
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

  @Post('read/:otherId')
  async markAsRead(@Req() req: any, @Param('otherId') otherId: string) {
    await this.messagesService.markAsRead(req.user.userId, otherId);
    return { success: true };
  }
}
