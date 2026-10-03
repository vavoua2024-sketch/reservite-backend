import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { AuthUser } from '../common/auth.types';
import { CurrentUser, Roles } from '../common/decorators';
import { assertSameCompany } from '../common/scope';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

class CreateProformaDto {
  @IsDateString() startDate: string;
  @IsDateString() endDate: string;
  @Type(() => Number) @IsInt() @Min(1) passengers: number;
  @IsOptional() @IsString() details?: string;
  /** Compagnies sollicitées : la demande part vers toutes en même temps. */
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) companyIds: string[];
}
class RespondDto {
  @Type(() => Number) @IsInt() @Min(0) price: number;
  @IsOptional() @IsString() message?: string;
  @IsOptional() @IsString() rentalVehicleId?: string;
}

const offerInclude = { company: { select: { id: true, name: true } }, rentalVehicle: { select: { id: true, name: true, type: true, seats: true } } };

@Controller('proforma')
export class ProformaController {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  @Roles('CLIENT') @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateProformaDto) {
    const start = new Date(dto.startDate), end = new Date(dto.endDate);
    if (start.getTime() < Date.now() - 86400_000) throw new BadRequestException('La date de début est passée.');
    if (end < start) throw new BadRequestException('La date de fin précède la date de début.');
    const companyIds = [...new Set(dto.companyIds)];
    const companies = await this.prisma.company.findMany({ where: { id: { in: companyIds }, isActive: true } });
    if (companies.length !== companyIds.length) throw new BadRequestException('Une des compagnies sélectionnées est introuvable.');
    const proforma = await this.prisma.proforma.create({
      data: {
        clientId: user.id, startDate: start, endDate: end, passengers: dto.passengers, details: dto.details,
        offers: { create: companyIds.map((companyId) => ({ companyId })) },
      },
      include: { offers: { include: offerInclude } },
    });
    const admins = await this.prisma.user.findMany({ where: { role: 'COMPANY_ADMIN', companyId: { in: companyIds }, isActive: true } });
    for (const a of admins) await this.notifications.notify(a.id, 'Nouvelle demande de location', `Demande pour ${dto.passengers} passagers du ${dto.startDate.slice(0, 10)}.`);
    return proforma;
  }

  /** Client : ses demandes avec toutes les offres reçues. Personnel : les offres adressées à sa compagnie. */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    if (user.role === 'CLIENT') {
      return this.prisma.proforma.findMany({ where: { clientId: user.id }, orderBy: { createdAt: 'desc' }, include: { offers: { include: offerInclude } } });
    }
    if (user.role === 'SUPER_ADMIN') {
      return this.prisma.proformaOffer.findMany({ orderBy: { createdAt: 'desc' }, include: { ...offerInclude, proforma: { include: { client: { select: { name: true, phone: true } } } } }, take: 300 });
    }
    return this.prisma.proformaOffer.findMany({
      where: { companyId: user.companyId ?? '__none__' }, orderBy: { createdAt: 'desc' }, take: 300,
      include: { ...offerInclude, proforma: { include: { client: { select: { name: true, phone: true } } } } },
    });
  }

  @Roles('COMPANY_ADMIN') @Post('offers/:id/respond')
  async respond(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RespondDto) {
    const offer = await this.prisma.proformaOffer.findUnique({ where: { id }, include: { proforma: true } });
    if (!offer) throw new NotFoundException('Offre introuvable.');
    assertSameCompany(user, offer.companyId);
    if (offer.proforma.status !== 'OPEN') throw new BadRequestException('Cette demande est déjà clôturée.');
    if (offer.status !== 'PENDING' && offer.status !== 'OFFERED') throw new BadRequestException('Cette offre ne peut plus être modifiée.');
    if (dto.rentalVehicleId) {
      const v = await this.prisma.rentalVehicle.findUniqueOrThrow({ where: { id: dto.rentalVehicleId } });
      assertSameCompany(user, v.companyId);
    }
    const updated = await this.prisma.proformaOffer.update({
      where: { id }, data: { price: dto.price, message: dto.message, rentalVehicleId: dto.rentalVehicleId, status: 'OFFERED', respondedAt: new Date() }, include: offerInclude,
    });
    await this.notifications.notify(offer.proforma.clientId, 'Nouvelle offre de location', `${updated.company.name} vous propose ${dto.price} FCFA.`);
    return updated;
  }

  @Roles('COMPANY_ADMIN') @Post('offers/:id/refuse')
  async refuse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const offer = await this.prisma.proformaOffer.findUniqueOrThrow({ where: { id } });
    assertSameCompany(user, offer.companyId);
    if (offer.status === 'ACCEPTED') throw new BadRequestException('Cette offre a déjà été acceptée.');
    return this.prisma.proformaOffer.update({ where: { id }, data: { status: 'REFUSED', respondedAt: new Date() }, include: offerInclude });
  }

  /** Le client retient une offre : les offres concurrentes sont refusées automatiquement, dans la même transaction. */
  @Roles('CLIENT') @Post('offers/:id/accept')
  async accept(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const target = await this.prisma.proformaOffer.findUnique({ where: { id }, include: { proforma: true } });
    if (!target || target.proforma.clientId !== user.id) throw new NotFoundException('Offre introuvable.');

    const refusedCompanies = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Proforma" WHERE id = ${target.proformaId} FOR UPDATE`;
      const proforma = await tx.proforma.findUniqueOrThrow({ where: { id: target.proformaId } });
      const offer = await tx.proformaOffer.findUniqueOrThrow({ where: { id } });
      if (proforma.status !== 'OPEN') throw new BadRequestException('Une offre a déjà été retenue pour cette demande.');
      if (offer.status !== 'OFFERED') throw new BadRequestException("Cette offre n'est pas disponible.");
      await tx.proformaOffer.update({ where: { id }, data: { status: 'ACCEPTED' } });
      const others = await tx.proformaOffer.findMany({ where: { proformaId: proforma.id, id: { not: id }, status: { in: ['PENDING', 'OFFERED'] } } });
      await tx.proformaOffer.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { status: 'REFUSED', respondedAt: new Date() } });
      await tx.proforma.update({ where: { id: proforma.id }, data: { status: 'ACCEPTED' } });
      return others.map((o) => o.companyId);
    });

    const admins = await this.prisma.user.findMany({ where: { role: 'COMPANY_ADMIN', companyId: { in: [target.companyId, ...refusedCompanies] } } });
    for (const a of admins) {
      const won = a.companyId === target.companyId;
      await this.notifications.notify(a.id, won ? 'Offre acceptée' : 'Offre non retenue', won ? 'Le client a accepté votre offre de location.' : 'Le client a choisi une autre compagnie.');
    }
    return this.prisma.proforma.findUniqueOrThrow({ where: { id: target.proformaId }, include: { offers: { include: offerInclude } } });
  }
}
