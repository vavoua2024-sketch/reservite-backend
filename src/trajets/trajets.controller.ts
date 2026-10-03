import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { AuthUser } from '../common/auth.types';
import { CurrentUser, Roles } from '../common/decorators';
import { assertSameCompany, companyForCreate } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';

class TrajetDto {
  @IsString() @MinLength(2) fromCity: string;
  @IsString() @MinLength(2) toCity: string;
  @IsInt() @Min(0) basePrice: number;
  @IsOptional() @IsInt() @Min(1) durationMin?: number;
  @IsOptional() @IsString() companyId?: string;
}
class UpdateTrajetDto {
  @IsOptional() @IsString() @MinLength(2) fromCity?: string;
  @IsOptional() @IsString() @MinLength(2) toCity?: string;
  @IsOptional() @IsInt() @Min(0) basePrice?: number;
  @IsOptional() @IsInt() @Min(1) durationMin?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('trajets')
export class TrajetsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) {
    const scope = user.companyId ? { companyId: user.companyId } : companyId ? { companyId } : {};
    const active = user.role === 'CLIENT' ? { isActive: true } : {};
    return this.prisma.trajet.findMany({
      where: { ...scope, ...active },
      orderBy: [{ fromCity: 'asc' }, { toCity: 'asc' }],
      include: { company: { select: { id: true, name: true } } },
    });
  }

  @Roles('SUPER_ADMIN', 'COMPANY_ADMIN') @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: TrajetDto) {
    const { companyId, ...rest } = dto;
    return this.prisma.trajet.create({ data: { ...rest, companyId: companyForCreate(user, companyId) } });
  }

  @Roles('SUPER_ADMIN', 'COMPANY_ADMIN') @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateTrajetDto) {
    const t = await this.prisma.trajet.findUniqueOrThrow({ where: { id } });
    assertSameCompany(user, t.companyId);
    return this.prisma.trajet.update({ where: { id }, data: dto });
  }

  @Roles('SUPER_ADMIN', 'COMPANY_ADMIN') @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const t = await this.prisma.trajet.findUniqueOrThrow({ where: { id } });
    assertSameCompany(user, t.companyId);
    await this.prisma.trajet.delete({ where: { id } });
    return { ok: true };
  }
}
