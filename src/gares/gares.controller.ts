import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { AuthUser } from '../common/auth.types';
import { CurrentUser, Roles } from '../common/decorators';
import { assertSameCompany, companyForCreate } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';

class GareDto {
  @IsString() @MinLength(2) name: string;
  @IsString() @MinLength(2) city: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() companyId?: string;
}
class UpdateGareDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() @MinLength(2) city?: string;
  @IsOptional() @IsString() address?: string;
}

@Controller('gares')
export class GaresController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('companyId') companyId?: string) {
    // Le personnel est limité à sa compagnie ; clients et SuperAdmin peuvent filtrer.
    const where = user.companyId ? { companyId: user.companyId } : companyId ? { companyId } : {};
    return this.prisma.gare.findMany({ where, orderBy: [{ city: 'asc' }, { name: 'asc' }] });
  }

  @Roles('SUPER_ADMIN', 'COMPANY_ADMIN') @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: GareDto) {
    return this.prisma.gare.create({
      data: { name: dto.name, city: dto.city, address: dto.address, companyId: companyForCreate(user, dto.companyId) },
    });
  }

  @Roles('SUPER_ADMIN', 'COMPANY_ADMIN') @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateGareDto) {
    const gare = await this.prisma.gare.findUniqueOrThrow({ where: { id } });
    assertSameCompany(user, gare.companyId);
    return this.prisma.gare.update({ where: { id }, data: dto });
  }

  @Roles('SUPER_ADMIN', 'COMPANY_ADMIN') @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const gare = await this.prisma.gare.findUniqueOrThrow({ where: { id } });
    assertSameCompany(user, gare.companyId);
    await this.prisma.gare.delete({ where: { id } });
    return { ok: true };
  }
}
