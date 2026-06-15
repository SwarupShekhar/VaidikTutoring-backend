import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { OnboardingCron } from './onboarding.cron';

@Module({
  imports: [EmailModule],
  providers: [OnboardingCron],
})
export class OnboardingModule {}
