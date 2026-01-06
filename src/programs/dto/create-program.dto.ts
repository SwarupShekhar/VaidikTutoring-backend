import { IsString, IsEnum, IsDateString, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProgramDto {
    @IsString()
    name: string;

    @IsEnum(['draft', 'active', 'completed'])
    status: string;

    @IsDateString()
    startDate: string;

    @IsDateString()
    endDate: string;

    @IsObject()
    academic: Record<string, any>;

    @IsObject()
    operational: Record<string, any>;

    @IsObject()
    financial: Record<string, any>;

    @IsObject()
    staffing: Record<string, any>;

    @IsObject()
    delivery: Record<string, any>;

    @IsObject()
    reporting: Record<string, any>;
}
