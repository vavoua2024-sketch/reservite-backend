import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { Booking } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const CINETPAY_BASE = 'https://api-checkout.cinetpay.com/v2';

@Injectable()
export class PaymentsService {
  private logger = new Logger('Paiements');
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  get provider(): 'simulated' | 'cinetpay' {
    return process.env.PAYMENT_PROVIDER === 'cinetpay' ? 'cinetpay' : 'simulated';
  }

  /** CinetPay exige des montants multiples de 5 en XOF (voir computeFees). */
  get amountStep() {
    return this.provider === 'cinetpay' ? 5 : 1;
  }

  /**
   * Démarre le paiement d'une réservation.
   * - simulated : accepté immédiatement (développement uniquement).
   * - cinetpay : renvoie l'adresse de paiement ; la validation se fait par le webhook, jamais par le client.
   */
  async initiate(booking: Booking, customer: { name: string; phone?: string | null; email?: string | null }) {
    if (this.provider === 'simulated') {
      await this.settle(booking.id, true);
      return { paymentUrl: null as string | null, status: 'PAID' as const };
    }
    const { CINETPAY_API_KEY: apikey, CINETPAY_SITE_ID: site_id } = process.env;
    if (!apikey || !site_id) throw new BadGatewayException('CinetPay n\'est pas configuré (clés manquantes).');
    const base = process.env.PUBLIC_API_URL || 'http://localhost:4000';
    const res = await fetch(`${CINETPAY_BASE}/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apikey, site_id, transaction_id: booking.paymentRef, amount: booking.total, currency: 'XOF',
        description: `Billets RESERVITE ${booking.paymentRef}`,
        notify_url: `${base}/payments/cinetpay/webhook`,
        return_url: process.env.PAYMENT_RETURN_URL || `${base}/health`,
        channels: 'ALL', lang: 'fr',
        customer_name: customer.name, customer_surname: customer.name,
        customer_phone_number: customer.phone || '', customer_email: customer.email || 'client@reservite.ci',
        customer_address: 'Abidjan', customer_city: 'Abidjan', customer_country: 'CI', customer_state: 'CI', customer_zip_code: '00225',
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (json?.code !== '201' || !json?.data?.payment_url) {
      this.logger.error(`CinetPay a refusé l'initiation : ${JSON.stringify(json)}`);
      throw new BadGatewayException('Le paiement n\'a pas pu être initié. Réessayez.');
    }
    await this.prisma.booking.update({ where: { id: booking.id }, data: { paymentUrl: json.data.payment_url } });
    return { paymentUrl: json.data.payment_url as string, status: 'PENDING' as const };
  }

  /** Webhook CinetPay : on ne croit pas le contenu reçu, on interroge CinetPay pour vérifier statut et montant. */
  async handleCinetpayWebhook(transactionId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { paymentRef: transactionId } });
    if (!booking) return { ok: false };
    if (booking.paymentStatus === 'PAID') return { ok: true }; // idempotent
    const { CINETPAY_API_KEY: apikey, CINETPAY_SITE_ID: site_id } = process.env;
    const res = await fetch(`${CINETPAY_BASE}/payment/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apikey, site_id, transaction_id: transactionId }),
    });
    const json: any = await res.json().catch(() => ({}));
    const status = json?.data?.status;
    if (status === 'ACCEPTED' && Number(json?.data?.amount) === booking.total) await this.settle(booking.id, true);
    else if (status === 'REFUSED' || status === 'CANCELED') await this.settle(booking.id, false);
    else this.logger.warn(`Statut CinetPay inattendu pour ${transactionId} : ${JSON.stringify(json)}`);
    return { ok: true };
  }

  /** Règle le résultat d'un paiement : billets valides si payé, annulés sinon. Sans effet si déjà réglé. */
  async settle(bookingId: string, paid: boolean) {
    const booking = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (booking.paymentStatus !== 'PENDING') return booking;
    const [updated] = await this.prisma.$transaction([
      this.prisma.booking.update({
        where: { id: bookingId },
        data: { paymentStatus: paid ? 'PAID' : 'FAILED', paidAt: paid ? new Date() : null },
      }),
      this.prisma.ticket.updateMany({
        where: { bookingId, status: 'PENDING' },
        data: paid ? { status: 'VALID', holdExpiresAt: null } : { status: 'CANCELLED', cancelledAt: new Date() },
      }),
    ]);
    if (booking.userId) {
      await this.notifications.notify(
        booking.userId,
        paid ? 'Paiement confirmé' : 'Paiement échoué',
        paid ? 'Vos billets sont prêts, retrouvez-les dans « Mes billets ».' : 'Le paiement a échoué. Aucun montant n\'a été débité pour cette réservation.',
      );
    }
    return updated;
  }
}
