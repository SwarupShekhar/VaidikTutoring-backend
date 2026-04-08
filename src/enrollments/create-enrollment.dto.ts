import { IsString, IsNotEmpty, IsEnum, IsArray, IsOptional, ValidateNested, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export enum SchedulePreset {
  TWO_SESSIONS_WEEK = 'TWO_SESSIONS_WEEK',
  THREE_SESSIONS_WEEK = 'THREE_SESSIONS_WEEK',
}

export class CreateEnrollmentDto {
  @IsString()
  @IsNotEmpty()
  student_id: string;

  @IsString()
  @IsNotEmpty()
  program_id: string;

  @IsString()
  @IsNotEmpty()
  package_id: string;

  @IsString()
  @IsOptional()
  tutor_id?: string;

  @IsString()
  @IsNotEmpty()
  curriculum_id: string;

  @IsArray()
  @IsString({ each: true })
  subject_ids: string[];

  @IsEnum(SchedulePreset)
  schedule_preset: SchedulePreset;

  @IsArray()
  @IsInt({ each: true })
  schedule_days: number[]; // e.g., [1, 3] (Monday, Wednesday)

  @IsString()
  @IsNotEmpty()
  start_time: string; // e.g., "16:00"
}
