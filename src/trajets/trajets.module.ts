import { Module } from '@nestjs/common';
import { TrajetsController } from './trajets.controller';

@Module({ controllers: [TrajetsController] })
export class TrajetsModule {}
