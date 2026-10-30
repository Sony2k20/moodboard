import { Logger, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import { createServer } from 'node:http';
import { MCP_BODY_LIMIT } from './app/mcp/mcp.controller';
import { AppModule } from './app/app.module';
import { AUTH_CONFIG, AuthConfig } from './app/auth/auth.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const globalPrefix = 'api';
  // Stored files keep the `/files/…` URLs the storage port builds (§4.2); the ingress routes
  // that prefix to the api as well.
  app.setGlobalPrefix(globalPrefix, {
    exclude: [{ path: 'files/{*path}', method: RequestMethod.GET }],
  });
  // `add_asset` sends an image of up to 25 MB as base64 (0010). Only this route gets the larger
  // limit; registered before Nest's own parsers, which then find the body already read. Every
  // other route keeps the 100 kB default, so a large body cannot be pushed at them unauthenticated.
  app.use(`/${globalPrefix}/mcp`, json({ limit: MCP_BODY_LIMIT }));
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
