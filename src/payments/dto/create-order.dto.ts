import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  packageId: string;

  @IsOptional()
  @IsString()
  couponCode?: string;
}
