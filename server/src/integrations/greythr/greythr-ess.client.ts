// HTTP client for the self-hosted greytHR ESS service. The only module that
// knows the greytHR API shape; callers depend on the GreytHrEssClient interface.
// Failures become a typed GreytHrEssError; the password is forwarded once and
// never stored or logged.

/** The subset of the greytHR `account` profile PixelOffice consumes. */
export interface GreytHrAccount {
  employeeId: number | null;
  /** Employee No / Login ID, e.g. "KCC00000". */
  employeeNo: string | null;
  loginId: string | null;
  name: string | null;
  email: string | null;
  /** Free-form HR department label (mapped to an office Department upstream). */
  department: string | null;
  designation: string | null;
  location: string | null;
  reportingManager: string | null;
  company: string | null;
  isManager: boolean;
  roles: string[];
}

export interface GreytHrLoginInput {
  /** Company subdomain (e.g. "kalvium"); optional. */
  subdomain?: string;
  /** Employee No / Login ID (not an email). */
  loginId: string;
  password: string;
}

export interface GreytHrLoginResult {
  /** Opaque greytHR session bearer token. */
  sessionId: string;
  account: GreytHrAccount;
}

/** Failure kind, so the caller can map to an HTTP status. */
export type GreytHrEssErrorKind =
  | "credentials" // greytHR rejected the login (bad employee no / password)
  | "bad_request" // missing/invalid input
  | "timeout"
  | "network"
  | "upstream" // greytHR returned a non-OK / unparseable response
  | "unauthorized"; // session expired / not authenticated

export class GreytHrEssError extends Error {
  constructor(
    message: string,
    readonly kind: GreytHrEssErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GreytHrEssError";
  }
}

/** The greytHR ESS boundary; implemented by the HTTP client and test fakes. */
export interface GreytHrEssClient {
  /** Authenticate an employee, returning a sessionId + account. */
  login(input: GreytHrLoginInput): Promise<GreytHrLoginResult>;
  /** Fetch the account profile for an existing sessionId. */
  getAccount(sessionId: string): Promise<GreytHrAccount>;
  /** End a greytHR session (POST /api/auth/logout). */
  logout(sessionId: string): Promise<void>;
}

/** Uniform greytHR envelope: { success, data, error }. */
interface GreytHrEnvelope<T> {
  success: boolean;
  data: T | null;
  error: { code?: string; message?: string } | null;
}

export interface HttpGreytHrEssClientConfig {
  /** Base URL of the greytHR client service, e.g. http://localhost:3000. */
  baseUrl: string;
  /** Per-request timeout (login is slower than data reads). Default 8000ms. */
  timeoutMs?: number;
  /** Injectable fetch for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 8000;

function normalizeAccount(raw: Record<string, unknown>): GreytHrAccount {
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  return {
    employeeId: num(raw.employeeId),
    employeeNo: str(raw.employeeNo),
    loginId: str(raw.loginId),
    name: str(raw.name),
    email: str(raw.email),
    department: str(raw.department),
    designation: str(raw.designation),
    location: str(raw.location),
    reportingManager: str(raw.reportingManager),
    company: str(raw.company),
    isManager: raw.isManager === true,
    roles: Array.isArray(raw.roles)
      ? raw.roles.filter((r): r is string => typeof r === "string")
      : [],
  };
}

export class HttpGreytHrEssClient implements GreytHrEssClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(config: HttpGreytHrEssClientConfig) {
    if (!config.baseUrl) {
      throw new Error("HttpGreytHrEssClient requires a baseUrl");
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
  }

  async login(input: GreytHrLoginInput): Promise<GreytHrLoginResult> {
    if (!input.loginId || !input.password) {
      throw new GreytHrEssError("loginId and password are required", "bad_request");
    }
    if (input.loginId.includes("@")) {
      throw new GreytHrEssError(
        "greytHR login uses the Employee No / Login ID, not an email",
        "bad_request",
      );
    }

    const body = await this.request<Record<string, unknown>>("POST", "/api/auth/login", {
      ...(input.subdomain ? { subdomain: input.subdomain } : {}),
      loginId: input.loginId,
      password: input.password,
    });

    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const account = body.account;
    if (!sessionId || !account || typeof account !== "object") {
      throw new GreytHrEssError("greytHR login returned no session", "upstream");
    }
    return {
      sessionId,
      account: normalizeAccount(account as Record<string, unknown>),
    };
  }

  async getAccount(sessionId: string): Promise<GreytHrAccount> {
    if (!sessionId) {
      throw new GreytHrEssError("sessionId is required", "bad_request");
    }
    const data = await this.request<Record<string, unknown>>(
      "GET",
      "/api/account/me",
      undefined,
      sessionId,
    );
    return normalizeAccount(data);
  }

  async logout(sessionId: string): Promise<void> {
    if (!sessionId) return;
    // greytHR reads the session from the Bearer header; no body.
    await this.request<unknown>("POST", "/api/auth/logout", undefined, sessionId);
  }

  /** Send a greytHR request: applies the timeout + Bearer, unwraps the envelope,
   *  maps failures to GreytHrEssError. */
  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    bearer?: string,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new GreytHrEssError(
          `greytHR request timed out after ${this.timeoutMs}ms`,
          "timeout",
        );
      }
      throw new GreytHrEssError(
        `greytHR network error: ${err instanceof Error ? err.message : String(err)}`,
        "network",
      );
    } finally {
      clearTimeout(timer);
    }

    let envelope: GreytHrEnvelope<T> | null = null;
    try {
      envelope = (await res.json()) as GreytHrEnvelope<T>;
    } catch {
      envelope = null;
    }

    if (!res.ok || !envelope || !envelope.success || envelope.data == null) {
      const code = envelope?.error?.code;
      const message = envelope?.error?.message ?? `greytHR HTTP ${res.status}`;
      if (res.status === 401 || code === "INVALID_CREDENTIALS") {
        throw new GreytHrEssError(message, "credentials", res.status);
      }
      if (res.status === 400 || code === "BAD_REQUEST") {
        throw new GreytHrEssError(message, "bad_request", res.status);
      }
      if (code === "SESSION_EXPIRED" || code === "UNAUTHORIZED") {
        throw new GreytHrEssError(message, "unauthorized", res.status);
      }
      throw new GreytHrEssError(message, "upstream", res.status);
    }

    return envelope.data;
  }
}
