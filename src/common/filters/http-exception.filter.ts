import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { SentryExceptionCaptured } from '@sentry/nestjs';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  @SentryExceptionCaptured()
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    // Normalize message if it's an object (NestJS sometimes returns {statusCode, message, error})
    let finalMessage = message;
    if (
      typeof message === 'object' &&
      message !== null &&
      'message' in message
    ) {
      finalMessage = (message as any).message;
    }

    // In production, never leak internal error details for 5xx responses
    if (process.env.NODE_ENV === 'production' && status >= 500) {
      finalMessage = 'An internal error occurred. Please try again later.';
    }

    response.status(status).json({
      statusCode: status,
      message: Array.isArray(finalMessage) ? finalMessage[0] : finalMessage,
      error:
        exception instanceof HttpException
          ? exception.name
          : 'InternalServerError',
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
