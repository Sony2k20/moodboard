import { Logger, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { createServer } from 'node:http';
import { AppModule } from './app/app.module';
import { configureBodyParsers } from './app/body-parsers';
import { AUTH_CONFIG, AuthConfig } from './app/auth/auth.config';

async function bootstrap() {
  // Body parsers are registered by hand below — see `configureBodyParsers`.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const globalPrefix = 'api';
  // Stored files keep the `/files/…` URLs the storage port builds (§4.2); the ingress routes
  // that prefix to the api as well.
  app.setGlobalPrefix(globalPrefix, {
    exclude: [{ path: 'files/{*path}', method: RequestMethod.GET }],
  });
  configureBodyParsers(app, globalPrefix);
  app.use(cookieParser());
  app.enableShutdownHooks();
  // The api sees one proxy hop (Traefik); without this `req.protocol` would read http.
  app.set('trust proxy', 1);

  const port = Number(process.env.PORT || 3000);
  await app.listen(port);

  // Same application, second listener: the emergency login answers only on this port, and the
  // chart routes it only from the LAN entry point (§4.10, 0003).
  const config = app.get<AuthConfig>(AUTH_CONFIG);
  if (config.emergencyAdmin) {
    const emergencyPort = config.emergencyAdmin.port;
    createServer(app.getHttpAdapter().getInstance()).listen(emergencyPort, () =>
      Logger.log(`Emergency admin login listening on port ${emergencyPort}`),
    );
  }
  Logger.log(`Authentication mode: ${config.mode}`);

  // Set when Nx waits for this server to be ready
  if (process.env.NX_READY_SIGNAL_SOCKET) {
    try {
      // Function keeps TypeScript and bundlers from rewriting or bundling the import
      const load = new Function('s', 'return import(s)') as (
        s: string,
      ) => Promise<{ emitReadySignal(server: unknown): boolean }>;
      (await load('@nx/js/ready-signal')).emitReadySignal(app.getHttpServer());
    } catch {
      // @nx/js isn't installed
    }
  }
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();
