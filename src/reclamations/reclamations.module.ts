import { Module } from '@nestjs/common';
import { ReclamationsController } from './reclamations.controller';

@Module({ controllers: [ReclamationsController] })
export class ReclamationsModule {}
