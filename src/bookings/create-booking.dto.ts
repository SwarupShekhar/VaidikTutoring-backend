// src/bookings/dto/create-booking.dto.ts
import {
  IsUUID,
  IsString,
  IsOptional,
  IsISO8601,
  IsArray,
  MaxLength,
} from 'class-validator';

export class CreateBookingDto {
  @IsUUID()
  student_id: string;

  @IsOptional()
  @IsUUID()
  program_id?: string;

  @IsUUID()
  package_id: string;

  @IsArray()
  @IsUUID('all', { each: true })
  subject_ids: string[];

  @IsUUID()
  curriculum_id: string;

  @IsISO8601()
  requested_start: string;

  @IsISO8601()
  requested_end: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
