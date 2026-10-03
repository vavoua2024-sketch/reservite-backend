import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuthUser } from '../common/auth.types';
import { CurrentUser, Roles } from '../common/decorators';
import { BookDto, ScanDto } from './dto';
import { TicketsService } from './tickets.service';

@Controller()
export class TicketsController {
  constructor(private tickets: TicketsService) {}

  /** Réservation : client (mobile money) ou guichet (caissier, gérant, admin). */
  @Roles('CLIENT', 'COMPANY_ADMIN', 'GARE_MANAGER', 'CASHIER') @Post('tickets/book')
  book(@CurrentUser() user: AuthUser, @Body() dto: BookDto) {
    return this.tickets.book(user, dto);
  }

  @Get('tickets')
  list(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.tickets.list(user, status);
  }

  @Roles('CONTROLLER', 'GARE_MANAGER', 'COMPANY_ADMIN') @Post('tickets/scan')
  scan(@CurrentUser() user: AuthUser, @Body() dto: ScanDto) {
    return this.tickets.scan(user, dto.code);
  }

  @Get('tickets/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tickets.get(user, id);
  }

  @Post('tickets/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tickets.cancel(user, id);
  }

  /** Suivi d'une réservation (l'app l'interroge après un paiement mobile money). */
  @Get('bookings/:id')
  booking(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tickets.getBooking(user, id);
  }
}
