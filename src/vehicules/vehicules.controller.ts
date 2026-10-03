import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { AuthUser, STAFF_ROLES } from '../common/auth.types';
import { CurrentUser, Roles } from '../common/decorators';
import { assertSameCompany, companyForCreate, companyScope } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';

class VehiculeDto {
  @IsString() @MinLength(2) plate: string;
  @IsOptional() @IsString() model?: string;
  @IsInt() @Min(1) @Max(100) capacity: number;
  @IsOptional() @IsString() companyId?: string;
}
class UpdateVehiculeDto {
  @IsOptional() @IsString() @MinLength(2) plate?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) capacity?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('vehicules')
export class VehiculesController {
  constructor(private prisma: PrismaService) {}

  @Roles(...STAFF_ROLES) @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.vehicule.findMany({ where: { companyId: companyScope(user) }, orderBy: { plate: 'asc' } });
  }

  @Roles('SUPER_ADMIN', 'COMPANY_ADMIN') @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: VehiculeDto) {
    const { companyId, ...rest } = dto;
    return this.prisma.vehicule.create({ data: { ...rest, companyId: companyForCreate(user, companyId) } });
  }

  @Roles('SUPER_ADMIN', 'COMPANY_ADMIN') @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateVehiculeDto) {
    const v = await this.prisma.vehicule.findUniqueOrThrow({ where: { id } });
    assertSameCompany(user, v.companyId);
    return this.prisma.vehicule.update({ where: { id }, data: dto });
  }

  @Roles('SUPER_ADMIN', 'COMPANY_ADMIN') @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const v = await this.prisma.vehicule.findUniqueOrThrow({ where: { id } });
    assertSameCompany(user, v.companyId);
    await this.prisma.vehicule.delete({ where: { id } });
    return { ok: true };
  }
}
