import { PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class BookDto {
  @IsString() voyageId: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(10) seats: number;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) passengers?: string[];
  @IsOptional() @IsEnum(PaymentMethod) paymentMethod?: PaymentMethod;
  /** Vente au guichet : identité du client sans compte. */
  @IsOptional() @IsString() customerName?: string;
  @IsOptional() @IsString() customerPhone?: string;
}

export class ScanDto {
  @IsString() code: string;
}
