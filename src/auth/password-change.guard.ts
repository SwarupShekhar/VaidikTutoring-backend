import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';

@Injectable()
export class PasswordChangeGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        // 1. If no user (public route), pass (unless other guards block)
        if (!user) return true;

        // 2. Check if forced to change password
        // We check the JWT payload property `force_password_change`
        // (Ensure JwtStrategy extracts this!)
        if (user.force_password_change === true) {
            throw new ForbiddenException('PASSWORD_RESET_REQUIRED');
        }

        return true;
    }
}
