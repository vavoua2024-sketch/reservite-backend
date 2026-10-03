import { Module } from '@nestjs/common';
import { VehiculesController } from './vehicules.controller';

@Module({ controllers: [VehiculesController] })
export class VehiculesModule {}
