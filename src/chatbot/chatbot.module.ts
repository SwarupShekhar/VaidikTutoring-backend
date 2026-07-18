import { Module } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { EmailModule } from '../email/email.module';
import { SlackModule } from '../slack/slack.module';

@Module({
  imports: [EmailModule, SlackModule],
  controllers: [ChatbotController],
  providers: [ChatbotService]
})
export class ChatbotModule {}
