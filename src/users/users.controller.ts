import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { AuthUser, COMPANY_ROLES } from '../common/auth.types';
import { CurrentUser, Roles } from '../common/decorators';
import { assertSameCompany } from '../common/scope';
import { PrismaService } from '../prisma/prisma.service';

class CreateUserDto {
  @IsString() @MinLength(2) name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsOptional() @IsString() phone?: string;
  @IsEnum(Role) role: Role;
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() gareId?: string;
}
class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() gareId?: string;
  @IsOptional() @IsString() @MinLength(8) password?: string;
}

const select = { id: true, name: true, email: true, phone: true, role: true, isActive: true, companyId: true, gareId: true, createdAt: true };
const MANAGEABLE: Role[] = ['GARE_MANAGER', 'CASHIER', 'CONTROLLER', 'PARCEL_AGENT'];

@Controller('users')
export class UsersController {
  constructor(private prisma: PrismaService) {}

  @Roles('SUPER_ADMIN', 'COMPANY_ADMIN', 'GARE_MANAGER') @Get()
  list(@CurrentUser() user: AuthUser, @Query('role') role?: Role) {
    const where = user.role === 'SUPER_ADMIN' ? { role: { not: 'CLIENT' as Role } } : { companyId: user.companyId ?? '__none__' };
    return this.prisma.user.findMany({ where: { ...where, ...(role && { role }) }, select, orderBy: { name: 'asc' } });
  }

  /** Création de personnel : l'Admin Compagnie crée les 4 rôles de sa compagnie ; le SuperAdmin crée aussi les Admins Compagnie. */
  @Roles('SUPER_ADMIN', 'COMPANY_ADMIN') @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto) {
    if (dto.role === 'CLIENT') throw new BadRequestException("Les clients s'inscrivent depuis l'application.");
    let companyId: string | null = null;
    if (user.role === 'COMPANY_ADMIN') {
      if (!MANAGEABLE.includes(dto.role)) throw new ForbiddenException("Vous pouvez créer : gérant de gare, caissier, contrôleur, agent colis.");
      companyId = user.companyId;
    } else if (COMPANY_ROLES.includes(dto.role)) {
      if (!dto.companyId) throw new BadRequestException('companyId requis pour ce rôle.');
      companyId = dto.companyId;
    }
    if (dto.gareId) assertSameCompany({ ...user, role: 'COMPANY_ADMIN', companyId } as AuthUser, (await this.prisma.gare.findUniqueOrThrow({ where: { id: dto.gareId } })).companyId);
    return this.prisma.user.create({
      data: {
        name: dto.name.trim(), email: dto.email.trim().toLowerCase(), phone: dto.phone, role: dto.role,
        companyId, gareId: dto.gareId, passwordHash: await bcrypt.hash(dto.password, 10),
      },
      select,
    });
  }

  @Roles('SUPER_ADMIN', 'COMPANY_ADMIN') @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    const target = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    if (target.role === 'CLIENT') throw new ForbiddenException('Les comptes clients ne se gèrent pas ici.');
    assertSameCompany(user, target.companyId);
    if (user.role === 'COMPANY_ADMIN' && !MANAGEABLE.includes(target.role)) throw new ForbiddenException("Vous ne pouvez pas modifier ce compte.");
    if (id === user.id && dto.isActive === false) throw new BadRequestException('Vous ne pouvez pas désactiver votre propre compte.');
    const { password, ...rest } = dto;
    return this.prisma.user.update({ where: { id }, data: { ...rest, ...(password && { passwordHash: await bcrypt.hash(password, 10) }) }, select });
  }
}
