import {
    Injectable,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
  } from '@nestjs/common';
  import { Reflector } from '@nestjs/core';
  
  @Injectable()
  export class RolesGuard implements CanActivate {
    constructor(private reflector: Reflector) {}
  
    canActivate(context: ExecutionContext): boolean {
      const required = this.reflector.get<string[]>('roles', context.getHandler());
      if (!required) return true;
  
      const { user } = context.switchToHttp().getRequest();
      if (!user) throw new ForbiddenException('No user logged in');
  
      if (!required.includes(user.role)) {
        throw new ForbiddenException('Insufficient role permissions');
      }
  
      return true;
    }
  }
  