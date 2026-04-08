import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class PhoneVerifiedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (!user) return false;
    if (user.phone_verified !== true) {
      throw new ForbiddenException('Please verify your phone number to access this feature.');
    }
    return true;
  }
}
