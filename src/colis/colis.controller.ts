import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ColisStatus } from '@prisma/client';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { AuthUser, STAFF_ROLES } from '../common/auth.types';
import { CurrentUser, Public, Roles } from '../common/decorators';
import { randomCode } from '../common/rules';
import { assertSameCompany, companyForCreate, companyScope } from '../common/scope';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

class CreateColisDto {
  @IsString() @MinLength(2) senderName: string;
  @IsString() @MinLength(6) senderPhone: string;
  @IsString() @MinLength(2) receiverName: string;
  @IsString() @MinLength(6) receiverPhone: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) weightKg?: number;
  @Type(() => Number) @IsInt() @Min(0) price: number;
  @IsString() @MinLength(2) originCity: string;
  @IsString() @MinLength(2) destCity: string;
  @IsOptional() @IsString() companyId?: string;
}
class StatusDto {
  @IsEnum(ColisStatus) status: ColisStatus;
  @IsOptional() @IsString() note?: string;
}

const LABELS: Record<ColisStatus, string> = {
  REGISTERED: 'enregistré',
  IN_TRANSIT: 'en route',
  ARRIVED: 'arrivé en gare, prêt à être retiré',
  DELIVERED: 'remis au destinataire',
};

@Controller('colis')
export class ColisController {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  /** Suivi public, sans connexion : on ne révèle ni noms ni téléphones. */
  @Public() @Get('track/:code')
  async track(@Param('code') code: string) {
    const c = await this.prisma.colis.findUnique({
      where: { trackingCode: code.trim().toUpperCase() },
      include: { company: { select: { name: true } }, events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!c) throw new NotFoundException('Aucun colis avec ce code.');
    return {
      trackingCode: c.trackingCode, status: c.status, originCity: c.originCity, destCity: c.destCity,
      company: c.company.name, updatedAt: c.updatedAt,
      events: c.events.map((e) => ({ status: e.status, note: e.note, createdAt: e.createdAt })),
    };
  }

  @Roles(...STAFF_ROLES) @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.colis.findMany({ where: { companyId: companyScope(user) }, orderBy: { createdAt: 'desc' }, take: 300 });
  }

  @Roles('PARCEL_AGENT', 'GARE_MANAGER', 'COMPANY_ADMIN', 'SUPER_ADMIN') @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const c = await this.prisma.colis.findUniqueOrThrow({ where: { id }, include: { events: { orderBy: { createdAt: 'asc' } }, sms: { orderBy: { createdAt: 'desc' } } } });
    assertSameCompany(user, c.companyId);
    return c;
  }

  @Roles('PARCEL_AGENT', 'GARE_MANAGER', 'COMPANY_ADMIN', 'SUPER_ADMIN') @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateColisDto) {
    const { companyId, ...rest } = dto;
    const colis = await this.prisma.colis.create({
      data: {
        ...rest, companyId: companyForCreate(user, companyId), createdById: user.id,
        trackingCode: randomCode('COL'), events: { create: { status: 'REGISTERED' } },
      },
    });
    const msg = `RESERVITE : colis ${colis.trackingCode} enregistré (${colis.originCity} > ${colis.destCity}). Suivi sur reservite.ci/suivi`;
    await this.notifications.sendSms(colis.senderPhone, msg, colis.id);
    await this.notifications.sendSms(colis.receiverPhone, msg, colis.id);
    return colis;
  }

  @Roles('PARCEL_AGENT', 'GARE_MANAGER', 'COMPANY_ADMIN', 'SUPER_ADMIN') @Patch(':id/status')
  async setStatus(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: StatusDto) {
    const c = await this.prisma.colis.findUniqueOrThrow({ where: { id } });
    assertSameCompany(user, c.companyId);
    if (c.status === 'DELIVERED') throw new BadRequestException('Ce colis a déjà été remis.');
    if (c.status === dto.status) throw new BadRequestException('Le colis a déjà ce statut.');
    const updated = await this.prisma.colis.update({
      where: { id }, data: { status: dto.status, events: { create: { status: dto.status, note: dto.note } } },
    });
    const msg = `RESERVITE : colis ${c.trackingCode} ${LABELS[dto.status]}.`;
    await this.notifications.sendSms(c.receiverPhone, msg, c.id);
    if (dto.status === 'DELIVERED') await this.notifications.sendSms(c.senderPhone, msg, c.id);
    return updated;
  }
}
