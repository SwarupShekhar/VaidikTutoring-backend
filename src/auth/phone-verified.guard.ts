import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';

@Injectable()
export class PhoneVerifiedGuard implements CanActivate {
  private readonly logger = new Logger(PhoneVerifiedGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (!user) return false;
    
    // Tutors and Admins are manually vetted and bypass the parent/student phone verification flow
    if (user.role === 'admin' || user.role === 'tutor') {
      return true;
    }

    if (user.phone_verified !== true) {
      this.logger.warn(`User ${user.userId} (role: ${user.role}) would have been denied access due to unverified phone, but bypassed temporarily.`);
      return true; // Temporarily bypassed
    }
    return true;
  }
}
