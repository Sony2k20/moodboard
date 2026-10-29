import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import * as oidc from 'openid-client';
import { AUTH_CONFIG, AuthConfig, OidcSettings } from './auth.config';
import { logoutClaims } from './identity';

/**
 * The only file that talks to the OIDC library. Everything here is lazy: discovery and the
 * signing keys are fetched on first use and retried on the next request after a failure, never
 * at startup — the api has to come up while Authentik is down, because that is exactly when the
 * emergency admin is needed (§4.10).
 */
export interface AuthorizationRequest {
  readonly url: string;
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
}

export interface CallbackResult {
  /** ID token claims merged with userinfo — Authentik may put `groups` in either. */
  readonly claims: Record<string, unknown>;
  readonly sid?: string;
  readonly idToken?: string;
}

@Injectable()
export class OidcClient {
  private readonly logger = new Logger(OidcClient.name);
  private configuration: Promise<oidc.Configuration> | null = null;

  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  get redirectUri(): string {
    return `${this.config.publicUrl}/api/auth/callback`;
  }

  async authorizationRequest(): Promise<AuthorizationRequest> {
    const configuration = await this.discover();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const url = oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: this.redirectUri,
      scope: 'openid email profile',
      code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    return { url: url.href, state, nonce, codeVerifier };
  }

  /** `callbackUrl` is the full URL the browser was sent to, as the public origin sees it. */
  async handleCallback(
    callbackUrl: URL,
    expected: { state: string; nonce: string; codeVerifier: string },
  ): Promise<CallbackResult> {
    const configuration = await this.discover();
    const tokens = await oidc.authorizationCodeGrant(
      configuration,
      callbackUrl,
      {
        pkceCodeVerifier: expected.codeVerifier,
        expectedState: expected.state,
        expectedNonce: expected.nonce,
        idTokenExpected: true,
      },
    );
    const idClaims = (tokens.claims() ?? {}) as Record<string, unknown>;
    const sub = idClaims['sub'] as string;
    const userinfo = await oidc.fetchUserInfo(
      configuration,
      tokens.access_token,
      sub,
    );

    return {
      claims: { ...userinfo, ...idClaims },
      sid: typeof idClaims['sid'] === 'string' ? idClaims['sid'] : undefined,
      idToken: tokens.id_token,
    };
  }

  /** Where the browser goes after the local session is gone. `null` if Authentik is unreachable. */
  async endSessionUrl(idToken: string | undefined): Promise<string | null> {
    try {
      const configuration = await this.discover();
      return oidc.buildEndSessionUrl(configuration, {
        post_logout_redirect_uri: `${this.config.publicUrl}/`,
        ...(idToken ? { id_token_hint: idToken } : {}),
      }).href;
    } catch {
      return null;
    }
  }

  /**
   * Verifies a backchannel logout token (OpenID Connect Back-Channel Logout 1.0, §2.6): signed by
   * the issuer, for this client, carrying the logout event and no nonce.
   */
  async verifyLogoutToken(
    token: string,
  ): Promise<{ sub?: string; sid?: string }> {
    const configuration = await this.discover();
    const metadata = configuration.serverMetadata();
    if (!metadata.jwks_uri) {
      throw new Error('The issuer publishes no jwks_uri');
    }
    const { payload } = await jwtVerify(token, this.jwks(metadata.jwks_uri), {
      issuer: metadata.issuer,
      audience: this.settings.clientId,
      maxTokenAge: '5m',
    });
    return logoutClaims(payload);
  }

  private get settings(): OidcSettings {
    if (!this.config.oidc) {
      throw new ServiceUnavailableException('Authentication is disabled');
    }
    return this.config.oidc;
  }

  private discover(): Promise<oidc.Configuration> {
    const settings = this.settings;
    if (!this.configuration) {
      this.configuration = oidc
        .discovery(
          new URL(settings.issuerUrl),
          settings.clientId,
          settings.clientSecret,
        )
        .catch((error: unknown) => {
          this.configuration = null;
          this.logger.error(`OIDC discovery failed: ${String(error)}`);
          throw new ServiceUnavailableException(
            'The identity provider is unreachable',
          );
        });
    }
    return this.configuration;
  }

  private jwksCache: {
    uri: string;
    set: ReturnType<typeof createRemoteJWKSet>;
  } | null = null;

  private jwks(uri: string): ReturnType<typeof createRemoteJWKSet> {
    if (this.jwksCache?.uri !== uri) {
      this.jwksCache = { uri, set: createRemoteJWKSet(new URL(uri)) };
    }
    return this.jwksCache.set;
  }
}
