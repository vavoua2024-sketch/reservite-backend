import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  /** Notification serveur à serveur de CinetPay (JSON ou formulaire). */
  @Public() @SkipThrottle() @HttpCode(200) @Post('cinetpay/webhook')
  async cinetpay(@Body() body: Record<string, any>) {
    const transactionId = body?.cpm_trans_id || body?.transaction_id;
    if (!transactionId) return { ok: false };
    return this.payments.handleCinetpayWebhook(String(transactionId));
  }
}
