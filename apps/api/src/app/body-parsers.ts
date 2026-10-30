import type { INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { MCP_BODY_LIMIT } from './mcp/mcp.controller';

/**
 * The request body parsers, registered by hand — the application is created with
 * `bodyParser: false`, and this replaces Nest's defaults (0010).
 *
 * Why by hand: `add_asset` sends images of up to 25 MB as base64, so `/api/mcp` needs a far larger
 * limit than every other route. Registering an extra parser only for that path next to Nest's own
 * does not work: Nest skips its global JSON parser when a middleware named `jsonParser` is already
 * there, and every other route then received no body at all (0.7.0–0.7.1).
 *
 * Order matters: the MCP parser runs first and marks the body as read, so the global one skips it.
 * Every other route keeps the 100 kB default, so nobody can push a large body at them before
 * authentication. `urlencoded` is for the OIDC backchannel logout, which posts a form.
 */
export function configureBodyParsers(app: INestApplication, globalPrefix: string): void {
  app.use(`/${globalPrefix}/mcp`, json({ limit: MCP_BODY_LIMIT }));
  app.use(json());
  app.use(urlencoded({ extended: true }));
}
