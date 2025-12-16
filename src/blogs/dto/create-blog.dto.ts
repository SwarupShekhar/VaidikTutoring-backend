import { IsString, IsNotEmpty, IsUrl } from 'class-validator';

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
}
