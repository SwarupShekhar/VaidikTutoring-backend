import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000, { message: 'Message text cannot exceed 2000 characters' })
  text: string;
}
