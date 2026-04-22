import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { EmailModule } from '../email/email.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminModule } from '../admin/admin.module';
import { CreditsModule } from '../credits/credits.module';
import { JwtStrategy } from './jwt.strategy';
import { ClerkAuthGuard } from './clerk-auth.guard';

@Global()
@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: (process.env.JWT_EXPIRATION || '1d') as any },
    }),
    EmailModule,
    AdminModule,
    CreditsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, ClerkAuthGuard],
  exports: [AuthService, JwtModule, ClerkAuthGuard],
})
export class AuthModule { }
