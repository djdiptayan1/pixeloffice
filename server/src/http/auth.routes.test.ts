// ---------------------------------------------------------------------------
// Auth routes — OAuth callback domain allowlist + state CSRF gate.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createAuthRouter } from "./auth.routes";
import type { AuthConfig } from "../auth/auth-config";
import { JwtService } from "../auth/jwt.service";
import { createState } from "../auth/oauth-state";
import { InMemoryUserRepository } from "../repositories/user.repository";
import type { OAuthIdentity, OAuthProvider, OAuthProviderId } from "../auth/oauth-provider";

const SECRET = "auth-routes-test-secret";

/** A stub provider that returns a fixed identity from exchangeCode. */
function stubProvider(id: OAuthProviderId, identity: OAuthIdentity): OAuthProvider {
  return {
    id,
    label: id,
    authorizationUrl: (state: string) => `https://idp.example/auth?state=${state}`,
    exchangeCode: async () => identity,
  };
}

function makeConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  const jwt = new JwtService({ secret: SECRET, warn: () => {} });
  return {
    jwt,
    providers: new Map(),
    adminEmails: new Set<string>(),
    defaultDepartment: "Engineering",
    clientAppUrl: "http://localhost:5173",
    authRequired: false,
    stateSecret: jwt.secretForState(),
    allowedEmailDomains: new Set<string>(),
    ...overrides,
  };
}

async function boot(config: AuthConfig): Promise<{ server: Server; base: string }> {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthRouter({ config, users: new InMemoryUserRepository() }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}` };
}

describe("auth callback — domain allowlist", () => {
  let server: Server;

  afterEach(() => server?.close());

  async function callback(config: AuthConfig): Promise<Response> {
    let base: string;
    ({ server, base } = await boot(config));
    const state = createState(config.stateSecret, { department: "Engineering" });
    return fetch(`${base}/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`, {
      redirect: "manual",
    });
  }

  it("rejects an email outside the allowlist with #error=domain_not_allowed", async () => {
    const providers = new Map<OAuthProviderId, OAuthProvider>([
      ["google", stubProvider("google", { subject: "g1", email: "x@evil.com", name: "X" })],
    ]);
    const config = makeConfig({ providers, allowedEmailDomains: new Set(["company.com"]) });
    const res = await callback(config);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("#error=domain_not_allowed");
  });

  it("admits an email inside the allowlist with a #token", async () => {
    const providers = new Map<OAuthProviderId, OAuthProvider>([
      ["google", stubProvider("google", { subject: "g1", email: "a@company.com", name: "A" })],
    ]);
    const config = makeConfig({ providers, allowedEmailDomains: new Set(["company.com"]) });
    const res = await callback(config);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("#token=");
  });

  it("no allowlist configured admits any verified email", async () => {
    const providers = new Map<OAuthProviderId, OAuthProvider>([
      ["google", stubProvider("google", { subject: "g1", email: "anyone@anywhere.io", name: "A" })],
    ]);
    const config = makeConfig({ providers });
    const res = await callback(config);
    expect(res.headers.get("location")).toContain("#token=");
  });
});

describe("auth callback — state CSRF gate", () => {
  let server: Server;
  afterEach(() => server?.close());

  it("rejects a missing/invalid state with 400", async () => {
    const providers = new Map<OAuthProviderId, OAuthProvider>([
      ["google", stubProvider("google", { subject: "g1", email: "a@company.com", name: "A" })],
    ]);
    const config = makeConfig({ providers });
    let base: string;
    ({ server, base } = await boot(config));
    const res = await fetch(`${base}/api/auth/google/callback?code=abc&state=tampered`, {
      redirect: "manual",
    });
    expect(res.status).toBe(400);
  });
});
