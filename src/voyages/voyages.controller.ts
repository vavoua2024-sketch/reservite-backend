import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma, VoyageStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { AuthUser, COMPANY_ROLES } from '../common/auth.types';
import { CurrentUser, Public, Roles } from '../common/decorators';
import { activeTicketWhere } from '../common/rules';
import { assertSameCompany, companyScope } from '../common/scope';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

class CreateVoyageDto {
  @IsString() trajetId: string;
  @IsString() vehiculeId: string;
  @IsOptional() @IsString() gareId?: string;
  @IsDateString() departureAt: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) price?: number;
}
class UpdateVoyageDto {
  @IsOptional() @IsDateString() departureAt?: string;
  @IsOptional() @IsString() gareId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) price?: number;
}

const include = {
  trajet: { select: { id: true, fromCity: true, toCity: true, durationMin: true } },
  vehicule: { select: { id: true, plate: true, model: true } },
  company: { select: { id: true, name: true, logoKey: true } },
  gare: { select: { id: true, name: true, city: true } },
} satisfies Prisma.VoyageInclude;

@Controller('voyages')
export class VoyagesController {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  /** Ajoute `seatsAvailable` (capacité moins places occupées), calculé en temps réel. */
  private async withSeats<T extends { id: string; seatsTotal: number }>(voyages: T[]) {
    if (voyages.length === 0) return [];
    const counts = await this.prisma.ticket.groupBy({
      by: ['voyageId'],
      where: { voyageId: { in: voyages.map((v) => v.id) }, ...activeTicketWhere() },
      _count: { _all: true },
    });
    const taken = new Map(counts.map((c) => [c.voyageId, c._count._all]));
    return voyages.map((v) => ({ ...v, seatsAvailable: Math.max(0, v.seatsTotal - (taken.get(v.id) ?? 0)) }));
  }

  /** Recherche : publique pour les voyages publiés à venir ; le personnel voit tous les statuts de sa compagnie. */
  @Public() @Get()
  async list(
    @CurrentUser() user: AuthUser | undefined,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('date') date?: string,
    @Query('companyId') companyId?: string,
    @Query('status') status?: VoyageStatus,
  ) {
    const staff = !!user && user.role !== 'CLIENT';
    const where: Prisma.VoyageWhereInput = {};
    if (staff) {
      where.companyId = companyScope(user!);
      if (status) where.status = status;
    } else {
      where.status = 'PUBLISHED';
      where.departureAt = { gte: new Date() };
      if (companyId) where.companyId = companyId;
    }
    if (from || to) where.trajet = { ...(from && { fromCity: { equals: from, mode: 'insensitive' } }), ...(to && { toCity: { equals: to, mode: 'insensitive' } }) };
    if (date) {
      const day = new Date(`${date}T00:00:00.000Z`);
      if (isNaN(day.getTime())) throw new BadRequestException('Date invalide (format AAAA-MM-JJ).');
      const range = { gte: new Date(Math.max(day.getTime(), staff ? 0 : Date.now())), lt: new Date(day.getTime() + 86400_000) };
      where.departureAt = range;
    }
    const voyages = await this.prisma.voyage.findMany({ where, include, orderBy: { departureAt: 'asc' }, take: 200 });
    return this.withSeats(voyages);
  }

  @Public() @Get(':id')
  async get(@CurrentUser() user: AuthUser | undefined, @Param('id') id: string) {
    const v = await this.prisma.voyage.findUnique({ where: { id }, include });
    if (!v) throw new NotFoundException('Voyage introuvable.');
    const staff = !!user && user.role !== 'CLIENT';
    if (staff) assertSameCompany(user!, v.companyId);
    else if (v.status !== 'PUBLISHED') throw new NotFoundException('Voyage introuvable.');
    return (await this.withSeats([v]))[0];
  }

  /** Liste des billets d'un voyage (pour le guichet et le contrôle à l'embarquement). */
  @Roles(...COMPANY_ROLES, 'SUPER_ADMIN') @Get(':id/tickets')
  async tickets(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const v = await this.prisma.voyage.findUniqueOrThrow({ where: { id } });
    assertSameCompany(user, v.companyId);
    return this.prisma.ticket.findMany({
      where: { voyageId: id, ...activeTicketWhere() },
      orderBy: { seatNumber: 'asc' },
      include: { booking: { select: { customerName: true, user: { select: { name: true, phone: true } } } } },
    });
  }

  @Roles('COMPANY_ADMIN', 'GARE_MANAGER', 'CASHIER') @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateVoyageDto) {
    const [trajet, vehicule] = await Promise.all([
      this.prisma.trajet.findUniqueOrThrow({ where: { id: dto.trajetId } }),
      this.prisma.vehicule.findUniqueOrThrow({ where: { id: dto.vehiculeId } }),
    ]);
    assertSameCompany(user, trajet.companyId);
    assertSameCompany(user, vehicule.companyId);
    if (dto.gareId) assertSameCompany(user, (await this.prisma.gare.findUniqueOrThrow({ where: { id: dto.gareId } })).companyId);
    const departureAt = new Date(dto.departureAt);
    if (departureAt.getTime() <= Date.now()) throw new BadRequestException('La date de départ doit être dans le futur.');
    const voyage = await this.prisma.voyage.create({
      data: {
        trajetId: trajet.id, vehiculeId: vehicule.id, gareId: dto.gareId ?? user.gareId ?? null,
        companyId: trajet.companyId, departureAt, price: dto.price ?? trajet.basePrice,
        seatsTotal: vehicule.capacity, status: 'DRAFT',
      },
      include,
    });
    return (await this.withSeats([voyage]))[0];
  }

  @Roles('COMPANY_ADMIN', 'GARE_MANAGER', 'CASHIER') @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateVoyageDto) {
    const v = await this.prisma.voyage.findUniqueOrThrow({ where: { id } });
    assertSameCompany(user, v.companyId);
    if (v.status === 'CANCELLED' || v.status === 'COMPLETED') throw new BadRequestException('Ce voyage ne peut plus être modifié.');
    const data: Prisma.VoyageUpdateInput = {};
    if (dto.departureAt) data.departureAt = new Date(dto.departureAt);
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.gareId) data.gare = { connect: { id: dto.gareId } };
    const updated = await this.prisma.voyage.update({ where: { id }, data, include });
    return (await this.withSeats([updated]))[0];
  }

  @Roles('COMPANY_ADMIN', 'GARE_MANAGER', 'CASHIER') @Post(':id/publish')
  async publish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const v = await this.prisma.voyage.findUniqueOrThrow({ where: { id } });
    assertSameCompany(user, v.companyId);
    if (v.status !== 'DRAFT') throw new BadRequestException('Seul un voyage en brouillon peut être publié.');
    if (v.departureAt.getTime() <= Date.now()) throw new BadRequestException('Le départ est déjà passé.');
    const updated = await this.prisma.voyage.update({ where: { id }, data: { status: 'PUBLISHED' }, include });
    return (await this.withSeats([updated]))[0];
  }

  /** Annule le voyage : tous les billets actifs sont annulés et remboursables en totalité. */
  @Roles('COMPANY_ADMIN', 'GARE_MANAGER') @Post(':id/cancel')
  async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const v = await this.prisma.voyage.findUniqueOrThrow({ where: { id } });
    assertSameCompany(user, v.companyId);
    if (v.status === 'CANCELLED') throw new BadRequestException('Ce voyage est déjà annulé.');
    const tickets = await this.prisma.ticket.findMany({ where: { voyageId: id, status: { in: ['PENDING', 'VALID'] } }, include: { booking: true } });
    await this.prisma.$transaction([
      this.prisma.voyage.update({ where: { id }, data: { status: 'CANCELLED' } }),
      ...tickets.map((t) =>
        this.prisma.ticket.update({
          where: { id: t.id },
          data: { status: 'CANCELLED', cancelledAt: new Date(), refundAmount: t.booking.paymentStatus === 'PAID' ? t.price : 0 },
        }),
      ),
    ]);
    const clients = new Set(tickets.map((t) => t.booking.userId).filter((x): x is string => !!x));
    for (const userId of clients) await this.notifications.notify(userId, 'Voyage annulé', 'Votre voyage a été annulé par la compagnie. Vous serez remboursé.');
    return { ok: true, cancelledTickets: tickets.length };
  }
}
