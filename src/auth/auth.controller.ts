import { Body, Controller, Post, BadRequestException, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { signupSchema } from './schemas/signup.schema.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) { }

  @Post('signup')
  async signup(@Body() body: unknown, @Req() req: any) {
    const data = signupSchema.parse(body);
    const ip = req.ip || req.connection?.remoteAddress;
    return this.auth.signup({ ...data, ip });
  }

  @Post('verify-email')
  verifyEmail(@Body('token') token: string) {
    if (!token) throw new BadRequestException('Token is required');
    return this.auth.verifyEmail(token);
  }

  @Post('resend-verification')
  @UseGuards(JwtAuthGuard)
  resendVerification(@Req() req: any) {
    return this.auth.resendVerification(req.user.userId || req.user.sub || req.user.id);
  }

  @Post('login')
  login(@Body() body: any) {
    return this.auth.login(body.email, body.password);
  }

  @Post('register-tutor')
  // Protected? 
  // I'll leave existing logic alone or update to use schema if appropriate, 
  // but prompt focused on 'signup' endpoint. 
  // Existing 'register-tutor' endpoint:
  createTutor(@Body() body: any) {
    if (body.role !== 'tutor')
      throw new BadRequestException('Role must be tutor');

    // Validate with simplified check or same schema?
    // Let's use schema but override role?
    // Or just manually call service.
    // original code called auth.signup(body).
    // I should probably clean up input here too.
    // But sticking to prompt's scope: "Update signup endpoint".
    // I'll leave this as is but warn it calls updated signup.
    return this.auth.signup(body);
  }
  @Post('accept-tutor-invite')
  acceptTutorInvite(@Body() body: any) {
    if (!body.token || !body.password) {
      throw new BadRequestException('Token and password are required');
    }
    return this.auth.acceptTutorInvite(body.token, body.password);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard) // Must be logged in to change
  changePassword(@Body() body: any, @Req() req: any) {
    if (!body.password) throw new BadRequestException('Password is required');
    return this.auth.changePassword(req.user.userId || req.user.sub, body.password);
  }
}
