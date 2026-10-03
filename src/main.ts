import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  configureApp(app);

  if (process.env.NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('RESERVITE API').setVersion('2.0').addBearerAuth().build());
    SwaggerModule.setup('docs', app, doc);
  }

  const port = Number(process.env.PORT || 4000);
  await app.listen(port, '0.0.0.0');
  new Logger('RESERVITE').log(`API démarrée sur http://localhost:${port} (santé : /health, documentation : /docs)`);
}
bootstrap();
