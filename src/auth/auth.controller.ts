import { Body, Controller, Post, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) { }

  @Post('signup')
  signup(@Body() body: any) {
    if (body.role !== 'parent' && body.role !== 'student') {
      throw new BadRequestException('Invalid role for public signup. Only "parent" and "student" are allowed.');
    }
    return this.auth.signup(body);
  }

  @Post('login')
  login(@Body() body: any) {
    return this.auth.login(body.email, body.password);
  }
}
