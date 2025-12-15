import { IsOptional, IsInt, Min } from 'class-validator';

export class UploadRecordingDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  duration_seconds?: number;

  @IsOptional()
  transcript?: string;
}
