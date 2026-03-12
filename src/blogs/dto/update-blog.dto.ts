import { PartialType } from '@nestjs/mapped-types';
import { CreateBlogDto } from './create-blog.dto.js';

export class UpdateBlogDto extends PartialType(CreateBlogDto) {}
