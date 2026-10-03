import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ReclamationStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { AuthUser, STAFF_ROLES } from '../common/auth.types';
import { CurrentUser, Roles } from '../common/decorators';
import { assertSameCompany } from '../common/scope';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

class CreateDto {
  @IsString() @MinLength(3) subject: string;
  @IsString() @MinLength(5) message: string;
  @IsOptional() @IsString() companyId?: string;
}
class UpdateDto {
  @IsOptional() @IsEnum(ReclamationStatus) status?: ReclamationStatus;
  @IsOptional() @IsString() response?: string;
}

@Controller('reclamations')
export class ReclamationsController {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  @Roles('CLIENT') @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDto) {
    return this.prisma.reclamation.create({ data: { userId: user.id, subject: dto.subject, message: dto.message, companyId: dto.companyId } });
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    const where = user.role === 'CLIENT' ? { userId: user.id } : user.role === 'SUPER_ADMIN' ? {} : { companyId: user.companyId ?? '__none__' };
    return this.prisma.reclamation.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 300,
      include: { user: { select: { name: true, phone: true } }, company: { select: { name: true } } },
    });
  }

  @Roles(...STAFF_ROLES) @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateDto) {
    const r = await this.prisma.reclamation.findUniqueOrThrow({ where: { id } });
    // Une réclamation sans compagnie est traitée par la plateforme (SuperAdmin).
    if (r.companyId || user.role !== 'SUPER_ADMIN') assertSameCompany(user, r.companyId);
    const updated = await this.prisma.reclamation.update({ where: { id }, data: dto });
    if (dto.response) await this.notifications.notify(r.userId, 'Réponse à votre réclamation', dto.response);
    return updated;
  }
}
