import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, ValidationPipe } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MinLength, ValidateNested, IsBoolean } from 'class-validator';
import * as bcrypt from 'bcryptjs';
import { AuthUser } from '../common/auth.types';
import { CurrentUser, Roles } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

class AdminDto {
  @IsString() @MinLength(2) name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsOptional() @IsString() phone?: string;
}

class CreateCompanyDto {
  @IsString() @MinLength(2) name: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  /** Compte Admin Compagnie créé en même temps (optionnel). */
  @IsOptional() @ValidateNested() @Type(() => AdminDto) admin?: AdminDto;
}

class UpdateCompanyDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() logoKey?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('companies')
export class CompaniesController {
  constructor(private prisma: PrismaService) {}

  /** Liste des compagnies : tout utilisateur connecté (le client choisit sa compagnie). */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    if (user.role === 'SUPER_ADMIN') {
      return this.prisma.company.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { users: true, gares: true, trajets: true, vehicules: true } } },
      });
    }
    return this.prisma.company.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, phone: true, logoKey: true },
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.prisma.company.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, phone: true, email: true, logoKey: true, isActive: true } });
  }

  @Roles('SUPER_ADMIN') @Post()
  async create(@Body() dto: CreateCompanyDto) {
    return this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: { name: dto.name.trim(), phone: dto.phone, email: dto.email } });
      if (dto.admin) {
        await tx.user.create({
          data: {
            name: dto.admin.name, email: dto.admin.email.trim().toLowerCase(), phone: dto.admin.phone,
            role: 'COMPANY_ADMIN', companyId: company.id, passwordHash: await bcrypt.hash(dto.admin.password, 10),
          },
        });
      }
      return company;
    });
  }

  @Roles('SUPER_ADMIN', 'COMPANY_ADMIN') @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateCompanyDto) {
    if (user.role !== 'SUPER_ADMIN') {
      if (id !== user.companyId) throw new ForbiddenException("Vous ne pouvez modifier que votre propre compagnie.");
      delete dto.isActive; // seul le SuperAdmin active ou désactive une compagnie
    }
    return this.prisma.company.update({ where: { id }, data: dto });
  }
}
