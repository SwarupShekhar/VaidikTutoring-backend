import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
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
        if (typeof message === 'object' && message !== null && 'message' in message) {
            finalMessage = (message as any).message;
        }

        response.status(status).json({
            statusCode: status,
            // Ensure message is top-level for frontend convenience
            message: Array.isArray(finalMessage) ? finalMessage[0] : finalMessage,
            error: exception instanceof HttpException ? exception.name : 'InternalServerError',
            timestamp: new Date().toISOString(),
            path: request.url,
        });
    }
}
