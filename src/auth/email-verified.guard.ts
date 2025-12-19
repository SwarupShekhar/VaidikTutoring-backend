import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';

@Injectable()
export class EmailVerifiedGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        if (!user) {
            // Guard should usually be used after JwtAuthGuard, so user should exist.
            // If not, let it pass and fail elsewhere or return false? 
            // Safest is to allow if no user (public?) or deny?
            // If endpoint is public, this guard shouldn't be here.
            // If endpoint is protected, user is set.
            return false;
        }

        if (user.email_verified !== true) {
            throw new ForbiddenException('Please verify your email address to access this feature.');
        }

        return true;
    }
}
