import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/auth.guard';

@Controller()
export class AppController {
  /** Liveness only — no database, no Valkey, no IdP. Public in every auth mode. */
  @Get('health')
  @Public()
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
