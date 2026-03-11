import { IsString, IsNotEmpty, IsUUID } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  packageId: string;
}
