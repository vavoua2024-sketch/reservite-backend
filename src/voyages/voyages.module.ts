import { Module } from '@nestjs/common';
import { VoyagesController } from './voyages.controller';

@Module({ controllers: [VoyagesController] })
export class VoyagesModule {}
