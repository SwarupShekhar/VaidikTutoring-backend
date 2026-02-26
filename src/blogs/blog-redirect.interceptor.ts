import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Response } from 'express';

@Injectable()
export class BlogRedirectInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const response = context.switchToHttp().getResponse<Response>();

        return next.handle().pipe(
            map((data) => {
                // Check if the response contains a redirect instruction
                if (data && data._redirect === true && data.status === 301) {
                    response.redirect(301, data.url);
                    return;
                }
                return data;
            })
        );
    }
}
