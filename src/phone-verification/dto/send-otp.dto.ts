import { IsString, IsIn, Matches } from 'class-validator';

export class SendOtpDto {
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, { message: 'Phone must be in E.164 format (e.g. +447911123456)' })
  phone: string;

  @IsIn(['sms', 'whatsapp'])
  channel: 'sms' | 'whatsapp';
}
