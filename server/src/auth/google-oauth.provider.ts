// ---------------------------------------------------------------------------
// Google OAuth 2.0 provider (authorization-code flow, plain fetch).
//
// Docs: https://developers.google.com/identity/protocols/oauth2/web-server
//   - authorize:  https://accounts.google.com/o/oauth2/v2/auth
//   - token:      https://oauth2.googleapis.com/token  (exchange code)
// We request the `openid email profile` scopes and read the userinfo endpoint
// for the normalized identity. Only constructed when GOOGLE_CLIENT_ID/SECRET
// are present (plan: integrations are optional).
// ---------------------------------------------------------------------------

import {
  redirectUriFor,
  type FetchLike,
  type OAuthBaseConfig,
  type OAuthIdentity,
  type OAuthProvider,
} from "./oauth-provider";

// Endpoint bases are env-overridable so a local stub can stand in for Google
// (the same overrides the Calendar integration uses). Defaults are the real
// Google endpoints; the userinfo host derives from GOOGLE_API_BASE's domain.
const DEFAULT_AUTH_BASE = "https://accounts.google.com";
const DEFAULT_TOKEN_BASE = "https://oauth2.googleapis.com";
const DEFAULT_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const SCOPE = "openid email profile";

function trimBase(v: string | undefined, fallback: string): string {
  return (v && v.trim() ? v.trim() : fallback).replace(/\/+$/, "");
}

export class GoogleOAuthProvider implements OAuthProvider {
  readonly id = "google" as const;
  readonly label = "Google";

  private readonly redirectUri: string;
  private readonly authEndpoint: string;
  private readonly tokenEndpoint: string;
  private readonly userinfoEndpoint: string;

  constructor(
    private readonly config: OAuthBaseConfig,
    private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.redirectUri = redirectUriFor("google", config.redirectBase);
    this.authEndpoint = `${trimBase(env.GOOGLE_AUTH_BASE, DEFAULT_AUTH_BASE)}/o/oauth2/v2/auth`;
    this.tokenEndpoint = `${trimBase(env.GOOGLE_TOKEN_BASE, DEFAULT_TOKEN_BASE)}/token`;
    // userinfo lives under the API host; override via GOOGLE_API_BASE when stubbed.
    this.userinfoEndpoint = env.GOOGLE_API_BASE?.trim()
      ? `${trimBase(env.GOOGLE_API_BASE, "")}/oauth2/v3/userinfo`
      : DEFAULT_USERINFO_ENDPOINT;
  }

  authorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: SCOPE,
      state,
      access_type: "online",
      prompt: "select_account",
    });
    return `${this.authEndpoint}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<OAuthIdentity> {
    const tokenRes = await this.fetchImpl(this.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
    if (!tokenRes.ok) {
      throw new Error(`Google token exchange failed (${tokenRes.status})`);
    }
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) {
      throw new Error("Google token exchange returned no access_token");
    }

    const infoRes = await this.fetchImpl(this.userinfoEndpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!infoRes.ok) {
      throw new Error(`Google userinfo failed (${infoRes.status})`);
    }
    const info = (await infoRes.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean | string;
      name?: string;
      given_name?: string;
    };
    if (!info.sub || !info.email) {
      throw new Error("Google userinfo missing sub/email");
    }
    // The email drives RBAC (admin) downstream, so it MUST be verified. Google's
    // /v1/userinfo returns email_verified; some encodings send the boolean as a
    // string ("true"). Reject anything not explicitly verified.
    if (info.email_verified !== true && info.email_verified !== "true") {
      throw new Error("Google userinfo email not verified");
    }
    return {
      subject: info.sub,
      email: info.email,
      name: info.name || info.given_name || info.email,
    };
  }
}
