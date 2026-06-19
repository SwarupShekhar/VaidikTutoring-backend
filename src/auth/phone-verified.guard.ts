import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class PhoneVerifiedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (!user) return false;
    
    // Tutors and Admins are manually vetted and bypass the parent/student phone verification flow
    if (user.role === 'admin' || user.role === 'tutor') {
      return true;
    }

    if (user.phone_verified !== true) {
      throw new ForbiddenException('Please verify your phone number to access this feature.');
    }
    return true;
  }
}
