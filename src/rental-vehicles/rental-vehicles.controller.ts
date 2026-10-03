import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { AuthUser, STAFF_ROLES } from '../common/auth.types';
import { CurrentUser, Roles } from '../common/decorators';
import { assertSameCompany, companyForCreate, companyScope } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';

class RentalDto {
  @IsString() @MinLength(2) name: string;
  @IsString() @MinLength(2) type: string;
  @IsInt() @Min(1) seats: number;
  @IsInt() @Min(0) pricePerDay: number;
  @IsOptional() @IsString() companyId?: string;
}
class UpdateRentalDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsInt() @Min(1) seats?: number;
  @IsOptional() @IsInt() @Min(0) pricePerDay?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('rental-vehicles')
export class RentalVehiclesController {
  constructor(private prisma: PrismaService) {}

  @Roles(...STAFF_ROLES) @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.rentalVehicle.findMany({ where: { companyId: companyScope(user) }, orderBy: { name: 'asc' } });
  }

  @Roles('SUPER_ADMIN', 'COMPANY_ADMIN') @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: RentalDto) {
    const { companyId, ...rest } = dto;
    return this.prisma.rentalVehicle.create({ data: { ...rest, companyId: companyForCreate(user, companyId) } });
  }

  @Roles('SUPER_ADMIN', 'COMPANY_ADMIN') @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateRentalDto) {
    const v = await this.prisma.rentalVehicle.findUniqueOrThrow({ where: { id } });
    assertSameCompany(user, v.companyId);
    return this.prisma.rentalVehicle.update({ where: { id }, data: dto });
  }

  @Roles('SUPER_ADMIN', 'COMPANY_ADMIN') @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const v = await this.prisma.rentalVehicle.findUniqueOrThrow({ where: { id } });
    assertSameCompany(user, v.companyId);
    await this.prisma.rentalVehicle.delete({ where: { id } });
    return { ok: true };
  }
}
