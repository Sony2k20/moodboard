import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './app/worker.module';

/**
 * The worker has no HTTP surface: it consumes the pipeline queue and reconciles against the
 * database (0004). An application context, not an application, so it opens no port.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  Logger.log('Worker started', 'Worker');
}

bootstrap();
