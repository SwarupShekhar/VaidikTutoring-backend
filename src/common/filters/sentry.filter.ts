import { Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';

@Catch()
export class SentryFilter extends BaseExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost) {
        const httpStatus =
            exception instanceof HttpException
                ? exception.getStatus()
                : HttpStatus.INTERNAL_SERVER_ERROR;

        // Only report 500s or non-http errors to Sentry to avoid noise (e.g. 404s)
        if (httpStatus === HttpStatus.INTERNAL_SERVER_ERROR) {
            Sentry.captureException(exception);
        }

        super.catch(exception, host);
    }
}
