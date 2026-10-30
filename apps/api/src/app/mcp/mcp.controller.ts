import { Controller, Delete, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { BearerToken, Public, User } from '../auth/auth.guard';
import type { CurrentUser } from '../auth/users.service';
import { McpServerFactory } from './mcp.server';

/** Base64 makes a 25 MB image about 34 MB; the rest is JSON-RPC around it. */
export const MCP_BODY_LIMIT = '36mb';

/**
 * Streamable HTTP, stateless (0010): every POST carries a complete JSON-RPC exchange, nothing is
 * kept between requests, so there is no session to store and any api replica can answer.
 */
@Controller('mcp')
export class McpController {
  constructor(private readonly servers: McpServerFactory) {}

  @Post()
  @BearerToken()
  async handle(
    @Req() req: Request,
    @Res() res: Response,
    @User() user: CurrentUser,
  ): Promise<void> {
    const server = this.servers.create(user);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  /** No server-initiated stream and no session to end in stateless mode. */
  @Get()
  @Delete()
  @Public()
  @HttpCode(405)
  notAllowed(): { jsonrpc: '2.0'; error: { code: number; message: string }; id: null } {
    return {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed: this server is stateless, use POST' },
      id: null,
    };
  }
}
