import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { ClientsModule } from './clients/clients.module';
import { ColisModule } from './colis/colis.module';
import { CompaniesModule } from './companies/companies.module';
import { JwtAuthGuard, RolesGuard } from './common/guards';
import { GaresModule } from './gares/gares.module';
import { HealthModule } from './health/health.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProformaModule } from './proforma/proforma.module';
import { ReclamationsModule } from './reclamations/reclamations.module';
import { RentalVehiclesModule } from './rental-vehicles/rental-vehicles.module';
import { StorageModule } from './storage/storage.module';
import { TicketsModule } from './tickets/tickets.module';
import { TrajetsModule } from './trajets/trajets.module';
import { UsersModule } from './users/users.module';
import { VehiculesModule } from './vehicules/vehicules.module';
import { VoyagesModule } from './voyages/voyages.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.registerAsync({
      global: true,
      useFactory: () => {
        if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
          throw new Error('JWT_SECRET manquant ou trop court (32 caractères minimum).');
        }
        return { secret: process.env.JWT_SECRET, signOptions: { expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || '1h') as any } };
      },
    }),
    // Limite générale : 120 requêtes par minute et par adresse IP.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule, NotificationsModule, PaymentsModule,
    AuthModule, CompaniesModule, GaresModule, TrajetsModule, VehiculesModule, VoyagesModule,
    TicketsModule, ColisModule, ProformaModule, RentalVehiclesModule, UsersModule, ClientsModule,
    ReclamationsModule, StorageModule, HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
