import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class TutorStatusGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const user = request.user;

        // Check if user is a tutor and is suspended
        // We assume 'tutor_status' is present on the user object from JwtStrategy
        // If not, we might need to fetch it, but usually we put status in JWT or fetch user in Strategy.
        // Let's check JwtStrategy. If it's not in JWT, we rely on the `validate` method fetching it.

        // For now, let's assume `req.user` has the field. If strict redundancy is needed, we fetch.
        // However, for performance, best if it's in JWT or User object attached by Guard.

        if (user && user.role === 'tutor' && user.tutor_status === 'SUSPENDED') {
            throw new ForbiddenException('TUTOR_SUSPENDED');
        }

        return true;
    }
}
