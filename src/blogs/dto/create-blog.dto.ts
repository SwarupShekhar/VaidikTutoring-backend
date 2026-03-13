import { IsString, IsNotEmpty, IsUrl, IsOptional, IsDateString } from 'class-validator';

export class CreateBlogDto {
    @IsString()
    @IsNotEmpty()
    title: string;

    @IsString()
    @IsNotEmpty()
    excerpt: string;

    @IsString()
    @IsNotEmpty()
    content: string;

    @IsString()
    @IsUrl()
    imageUrl: string;

    @IsString()
    @IsNotEmpty()
    category: string;

    @IsString()
    @IsOptional()
    imageAlt?: string;

    @IsDateString()
    @IsOptional()
    publishedAt?: string;
}
