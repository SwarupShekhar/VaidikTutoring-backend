import { IsString, Matches, Length } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, { message: 'Phone must be in E.164 format' })
  phone: string;

  @IsString()
  @Length(4, 10)
  code: string;
}
