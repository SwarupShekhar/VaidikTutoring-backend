// src/bookings/dto/create-booking.dto.ts
import { IsUUID, IsString, IsOptional, IsISO8601 } from 'class-validator';

export class CreateBookingDto {
  @IsUUID()
  student_id: string;

  @IsUUID()
  package_id: string;

  @IsUUID()
  subject_id: string;

  @IsUUID()
  curriculum_id: string;

  @IsISO8601()
  requested_start: string;

  @IsISO8601()
  requested_end: string;

  @IsOptional()
  @IsString()
  note?: string;
}
