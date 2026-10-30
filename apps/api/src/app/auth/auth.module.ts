import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiTokensController } from './api-tokens.controller';
import { ApiTokensService } from './api-tokens.service';
import { AUTH_CONFIG, authConfigFromEnv } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { EmergencyController } from './emergency.controller';
import { MeController } from './me.controller';
import { OidcClient } from './oidc.client';
import { SessionStore } from './session.store';
import { UsersService } from './users.service';

@Module({
  controllers: [
    AuthController,
    EmergencyController,
    MeController,
    ApiTokensController,
  ],
  providers: [
    { provide: AUTH_CONFIG, useFactory: authConfigFromEnv },
    OidcClient,
    SessionStore,
    UsersService,
    ApiTokensService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AUTH_CONFIG],
})
export class AuthModule {}
