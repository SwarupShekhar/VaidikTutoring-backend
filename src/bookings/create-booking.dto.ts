// src/bookings/dto/create-booking.dto.ts
import { IsUUID, IsString, IsOptional, IsISO8601, IsArray } from 'class-validator';

export class CreateBookingDto {
  @IsUUID()
  student_id: string;

  @IsString()
  package_id: string;

  @IsArray()
  @IsString({ each: true })
  subject_ids: string[];

  @IsString()
  curriculum_id: string;

  @IsISO8601()
  requested_start: string;

  @IsISO8601()
  requested_end: string;

  @IsOptional()
  @IsString()
  note?: string;
}
