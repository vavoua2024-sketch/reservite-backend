import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  private logger = new Logger('Notifications');
  constructor(private prisma: PrismaService) {}

  /** Notification in-app + push Expo si l'utilisateur a enregistré un appareil. Ne bloque jamais l'appelant. */
  async notify(userId: string, title: string, body: string) {
    await this.prisma.notification.create({ data: { userId, title, body } });
    this.push(userId, title, body).catch((e) => this.logger.warn(`Push échoué : ${e?.message}`));
  }

  private async push(userId: string, title: string, body: string) {
    const devices = await this.prisma.deviceToken.findMany({ where: { userId } });
    const messages = devices.filter((d) => d.token.startsWith('ExponentPushToken')).map((d) => ({ to: d.token, title, body }));
    if (messages.length === 0) return;
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
  }

  /** SMS : journalisé en base. Brancher ici Twilio ou un agrégateur local quand SMS_PROVIDER change. */
  async sendSms(to: string, body: string, colisId?: string) {
    const provider = process.env.SMS_PROVIDER || 'log';
    if (provider === 'log') this.logger.log(`[SMS simulé] ${to} : ${body}`);
    else this.logger.warn(`SMS_PROVIDER=${provider} n'est pas encore branché : SMS non envoyé.`);
    return this.prisma.smsLog.create({
      data: { to, body, colisId, status: provider === 'log' ? 'LOGGED' : 'NOT_SENT' },
    });
  }

  /** E-mail transactionnel : journalisé tant qu'aucun fournisseur (Resend, Brevo...) n'est branché. */
  async sendEmail(to: string, subject: string, body: string) {
    const provider = process.env.EMAIL_PROVIDER || 'log';
    if (provider === 'log') this.logger.log(`[E-mail simulé] ${to} | ${subject} | ${body}`);
    else this.logger.warn(`EMAIL_PROVIDER=${provider} n'est pas encore branché : e-mail non envoyé.`);
  }
}
