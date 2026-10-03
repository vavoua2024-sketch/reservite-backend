import { Module } from '@nestjs/common';
import { ProformaController } from './proforma.controller';

@Module({ controllers: [ProformaController] })
export class ProformaModule {}
