import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../common/auth.types';
import { activeTicketWhere, canCancel, computeFees, pickSeats, randomCode } from '../common/rules';
import { assertSameCompany } from '../common/scope';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { BookDto } from './dto';

const ticketInclude = {
  voyage: {
    include: {
      trajet: { select: { fromCity: true, toCity: true } },
      company: { select: { id: true, name: true } },
      vehicule: { select: { plate: true } },
    },
  },
  booking: { select: { id: true, total: true, fee: true, paymentStatus: true, paymentMethod: true } },
} satisfies Prisma.TicketInclude;

@Injectable()
export class TicketsService {
  constructor(private prisma: PrismaService, private payments: PaymentsService, private notifications: NotificationsService) {}

  private num(name: string, fallback: number) {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && process.env[name] ? v : fallback;
  }

  /**
   * Réservation avec anti-survente : le voyage est verrouillé (FOR UPDATE) le temps de compter les places
   * et d'enregistrer les billets, donc deux clients ne peuvent jamais obtenir la même place.
   */
  async book(user: AuthUser, dto: BookDto) {
    const counter = ['COMPANY_ADMIN', 'GARE_MANAGER', 'CASHIER'].includes(user.role);
    if (user.role !== 'CLIENT' && !counter) throw new ForbiddenException("Votre rôle ne permet pas de vendre des billets.");
    const method = counter ? dto.paymentMethod ?? 'CASH' : 'MOBILE_MONEY';
    if (!counter && dto.paymentMethod && dto.paymentMethod !== 'MOBILE_MONEY') throw new BadRequestException('Mode de paiement non autorisé.');

    const feeRate = this.num('SERVICE_FEE_RATE', 0.05);
    const holdMs = this.num('SEAT_HOLD_MINUTES', 15) * 60_000;
    const step = method === 'MOBILE_MONEY' ? this.payments.amountStep : 1;

    const booking = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Voyage" WHERE id = ${dto.voyageId} FOR UPDATE`;
      const voyage = await tx.voyage.findUnique({ where: { id: dto.voyageId } });
      if (!voyage) throw new NotFoundException('Voyage introuvable.');
      if (counter) assertSameCompany(user, voyage.companyId);
      if (voyage.status !== 'PUBLISHED') throw new BadRequestException("Ce voyage n'est pas ouvert à la réservation.");
      if (voyage.departureAt.getTime() <= Date.now()) throw new BadRequestException('Ce voyage est déjà parti.');

      const active = await tx.ticket.findMany({ where: { voyageId: voyage.id, ...activeTicketWhere() }, select: { seatNumber: true } });
      const seats = pickSeats(voyage.seatsTotal, active.map((t) => t.seatNumber), dto.seats);
      if (!seats) {
        const left = voyage.seatsTotal - active.length;
        throw new ConflictException(left <= 0 ? 'Ce voyage est complet.' : `Il ne reste que ${left} place(s) sur ce voyage.`);
      }

      const { subtotal, fee, total } = computeFees(voyage.price, dto.seats, feeRate, step);
      const cash = method === 'CASH';
      return tx.booking.create({
        data: {
          voyageId: voyage.id,
          userId: user.role === 'CLIENT' ? user.id : null,
          soldById: counter ? user.id : null,
          customerName: counter ? dto.customerName : null,
          customerPhone: counter ? dto.customerPhone : null,
          seatsCount: dto.seats, subtotal, fee, total,
          paymentMethod: method,
          paymentStatus: cash ? 'PAID' : 'PENDING',
          paidAt: cash ? new Date() : null,
          paymentRef: randomCode('PAY', 10),
          tickets: {
            create: seats.map((seatNumber, i) => ({
              voyageId: voyage.id, seatNumber, price: voyage.price,
              code: randomCode('TKT'),
              passengerName: dto.passengers?.[i] ?? null,
              status: cash ? 'VALID' : 'PENDING',
              holdExpiresAt: cash ? null : new Date(Date.now() + holdMs),
            })),
          },
        },
      });
    });

    let paymentUrl: string | null = null;
    if (booking.paymentStatus === 'PENDING') {
      const profile = await this.prisma.user.findUnique({ where: { id: user.id } });
      try {
        const res = await this.payments.initiate(booking, { name: profile?.name ?? 'Client', phone: profile?.phone, email: profile?.email });
        paymentUrl = res.paymentUrl;
      } catch (e) {
        await this.payments.settle(booking.id, false); // libère les places si le paiement ne peut pas démarrer
        throw e;
      }
    }
    return this.getBooking(user, booking.id).then((b) => ({ ...b, paymentUrl: paymentUrl ?? b.paymentUrl }));
  }

  async getBooking(user: AuthUser, id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: { tickets: { orderBy: { seatNumber: 'asc' } }, voyage: { include: { trajet: true, company: { select: { id: true, name: true } } } } },
    });
    if (!booking) throw new NotFoundException('Réservation introuvable.');
    if (user.role === 'CLIENT') {
      if (booking.userId !== user.id) throw new NotFoundException('Réservation introuvable.');
    } else assertSameCompany(user, booking.voyage.companyId);
    return booking;
  }

  list(user: AuthUser, status?: string) {
    const where: Prisma.TicketWhereInput =
      user.role === 'CLIENT' ? { booking: { userId: user.id } } : user.role === 'SUPER_ADMIN' ? {} : { voyage: { companyId: user.companyId ?? '__none__' } };
    if (status) where.status = status as any;
    // Les réservations en attente expirées ne sont pas affichées.
    where.NOT = { status: 'PENDING', holdExpiresAt: { lte: new Date() } };
    return this.prisma.ticket.findMany({ where, include: ticketInclude, orderBy: { voyage: { departureAt: 'desc' } }, take: 300 });
  }

  async get(user: AuthUser, id: string) {
    const t = await this.prisma.ticket.findUnique({ where: { id }, include: { ...ticketInclude, booking: true } });
    if (!t) throw new NotFoundException('Billet introuvable.');
    if (user.role === 'CLIENT') {
      if (t.booking.userId !== user.id) throw new NotFoundException('Billet introuvable.');
    } else assertSameCompany(user, t.voyage.companyId);
    return t;
  }

  /** Annulation : les clients doivent respecter la limite (2 h avant le départ) ; la compagnie peut annuler à tout moment. */
  async cancel(user: AuthUser, id: string) {
    if (['CASHIER', 'CONTROLLER', 'PARCEL_AGENT'].includes(user.role)) throw new ForbiddenException("Votre rôle ne permet pas d'annuler un billet.");
    const t = await this.get(user, id);
    if (t.status === 'CANCELLED') throw new BadRequestException('Ce billet est déjà annulé.');
    if (t.status === 'SCANNED') throw new BadRequestException('Ce billet a déjà été utilisé.');
    const limit = this.num('CANCEL_LIMIT_HOURS', 2);
    const companyStaff = ['COMPANY_ADMIN', 'GARE_MANAGER', 'SUPER_ADMIN'].includes(user.role);
    if (!companyStaff && !canCancel(t.voyage.departureAt, new Date(), limit)) {
      throw new BadRequestException(`Annulation impossible : moins de ${limit} h avant le départ.`);
    }
    // Remboursement dû : prix du billet, sans les frais de service (règle par défaut, à confirmer avec le commanditaire).
    const refundAmount = t.booking.paymentStatus === 'PAID' ? t.price : 0;
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), refundAmount },
      include: ticketInclude,
    });
    if (t.booking.userId && companyStaff) {
      await this.notifications.notify(t.booking.userId, 'Billet annulé', `Votre billet place ${t.seatNumber} a été annulé par la compagnie.`);
    }
    return updated;
  }

  /** Scan à l'embarquement : un billet n'est accepté qu'une seule fois, pour un voyage de la compagnie du contrôleur. */
  async scan(user: AuthUser, code: string) {
    const t = await this.prisma.ticket.findUnique({ where: { code: code.trim().toUpperCase() }, include: ticketInclude });
    if (!t) throw new NotFoundException('Billet inconnu.');
    assertSameCompany(user, t.voyage.companyId);
    if (t.status === 'CANCELLED') throw new BadRequestException('Billet annulé.');
    if (t.status === 'PENDING') throw new BadRequestException('Paiement non confirmé pour ce billet.');
    if (t.voyage.status === 'CANCELLED') throw new BadRequestException('Ce voyage a été annulé.');
    // Mise à jour conditionnelle : si deux contrôleurs scannent en même temps, un seul réussit.
    const res = await this.prisma.ticket.updateMany({
      where: { id: t.id, status: 'VALID' },
      data: { status: 'SCANNED', scannedAt: new Date(), scannedById: user.id },
    });
    if (res.count === 0) {
      const again = await this.prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
      throw new ConflictException(`Billet déjà scanné${again.scannedAt ? ` le ${again.scannedAt.toISOString()}` : ''}.`);
    }
    return { ok: true, ticket: { ...t, status: 'SCANNED' } };
  }
}
