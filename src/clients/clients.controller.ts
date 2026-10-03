import { Controller, ForbiddenException, Get, NotFoundException, Param } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../common/auth.types';
import { CurrentUser, Roles } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

const select = { id: true, name: true, email: true, phone: true, createdAt: true };

/** Liste des clients : tous pour le SuperAdmin ; pour une compagnie, uniquement ceux qui ont réservé chez elle. */
@Controller('clients')
export class ClientsController {
  constructor(private prisma: PrismaService) {}

  private scope(user: AuthUser): Prisma.UserWhereInput {
    if (user.role === 'SUPER_ADMIN') return { role: 'CLIENT' };
    if (!user.companyId) throw new ForbiddenException();
    return { role: 'CLIENT', bookings: { some: { voyage: { companyId: user.companyId } } } };
  }

  @Roles('SUPER_ADMIN', 'COMPANY_ADMIN', 'GARE_MANAGER', 'CASHIER') @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.user.findMany({ where: this.scope(user), select, orderBy: { createdAt: 'desc' }, take: 300 });
  }

  @Roles('SUPER_ADMIN', 'COMPANY_ADMIN', 'GARE_MANAGER', 'CASHIER') @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const c = await this.prisma.user.findFirst({ where: { id, ...this.scope(user) }, select });
    if (!c) throw new NotFoundException('Client introuvable.');
    return c;
  }
}
