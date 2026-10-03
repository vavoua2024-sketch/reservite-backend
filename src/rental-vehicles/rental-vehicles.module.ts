import { Module } from '@nestjs/common';
import { RentalVehiclesController } from './rental-vehicles.controller';

@Module({ controllers: [RentalVehiclesController] })
export class RentalVehiclesModule {}
