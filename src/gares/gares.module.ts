import { Module } from '@nestjs/common';
import { GaresController } from './gares.controller';

@Module({ controllers: [GaresController] })
export class GaresModule {}
