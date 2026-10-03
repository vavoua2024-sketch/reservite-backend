import { Module } from '@nestjs/common';
import { ColisController } from './colis.controller';

@Module({ controllers: [ColisController] })
export class ColisModule {}
