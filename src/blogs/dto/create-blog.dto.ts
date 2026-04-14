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

    @IsString()
    @IsOptional()
    slug?: string;

    @IsString()
    @IsOptional()
    seoTitle?: string;

    @IsString()
    @IsOptional()
    seoDescription?: string;

    @IsString()
    @IsOptional()
    targetKeyword?: string;

    @IsOptional()
    related_blog_ids?: string[];

    @IsDateString()
    @IsOptional()
    publishedAt?: string;
}
