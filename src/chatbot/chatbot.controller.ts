import { Controller, Post, Body, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ChatbotService, ChatMessage, ChatLeadDto } from './chatbot.service';

@Controller('api/chatbot')
export class ChatbotController {
  constructor(private readonly chatbotService: ChatbotService) {}

  @Post('public')
  async handleChat(
    @Body() body: { message?: string; history?: ChatMessage[]; turnstileToken?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // X-Forwarded-For may be "client, proxy1, proxy2" and is client-spoofable.
    // Take the first hop as the claimed client IP. For real protection the app MUST sit
    // behind a proxy that overwrites this header (nginx real_ip / Express 'trust proxy');
    // otherwise per-IP limits can be bypassed by forging the header.
    const xff = (req.headers['x-forwarded-for'] as string) || '';
    const ip = xff.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

    const userMessage = body.message || '';
    const history = body.history || [];

    try {
      const stream = await this.chatbotService.getChatStream(
        userMessage,
        history,
        ip,
        body.turnstileToken || '',
      );

      // Plain streaming text response. Deliberately NOT the Vercel AI SDK data-stream
      // protocol — the client reads the raw body stream and appends chunks directly,
      // which keeps us decoupled from AI SDK major-version protocol changes.
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // tell nginx not to buffer the stream
      res.flushHeaders();

      // Collect the full transcript for logging while streaming to the user instantly.
      let fullResponse = '';

      for await (const chunk of stream) {
        const textChunk = chunk.text || '';
        fullResponse += textChunk;
        res.write(textChunk);
      }

      res.end();

      // Fire-and-forget logging (persistent Node process — no serverless waitUntil needed).
      // logInteraction never throws, but guard anyway so a rejection can't go unhandled.
      void this.chatbotService.logInteraction(ip, userMessage, fullResponse).catch(() => undefined);
    } catch (error) {
      if (!res.headersSent) {
        const status = error.getStatus ? error.getStatus() : 500;
        res.status(status).json({ message: error.message });
      } else {
        console.error('Stream error mid-flight:', error);
        // Stream already started — end it; the client keeps whatever partial text arrived.
        res.end();
      }
    }
  }

  @Post('lead')
  async handleLead(
    @Body() body: ChatLeadDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Derive client IP the same way as the chat route: first hop of
    // X-Forwarded-For (spoofable unless behind a trusted proxy), else socket.
    const xff = (req.headers['x-forwarded-for'] as string) || '';
    const ip = xff.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

    try {
      const result = await this.chatbotService.createLead(body, ip);
      return res.status(201).json(result);
    } catch (error: any) {
      const status =
        typeof error?.getStatus === 'function' ? error.getStatus() : 500;
      const message =
        typeof error?.message === 'string' ? error.message : 'Failed to submit';
      return res.status(status).json({ message });
    }
  }
}
