import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );

  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';

  app.enableCors({ origin: webOrigin, credentials: true });
  app.setGlobalPrefix('api');

  // Socket.IO rides on the same HTTP server as the REST API so there is one
  // port and one origin to configure in every environment.
  app.useWebSocketAdapter(new IoAdapter(app));

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');

  Logger.log(`QueueOS API listening on http://localhost:${port}/api`, 'Bootstrap');
}

bootstrap();
