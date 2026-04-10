import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class VerifyPaymentDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^order_[A-Za-z0-9]+$/, { message: 'Invalid Razorpay order ID format' })
  razorpayOrderId: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^pay_[A-Za-z0-9]+$/, { message: 'Invalid Razorpay payment ID format' })
  razorpayPaymentId: string;

  @IsString()
  @IsNotEmpty()
  razorpaySignature: string;
}
