// ---------------------------------------------------------------------------
// Real GreytHR REST adapter (live API).
//
// Selected by the container when GreytHR env config is present (either an
// api-user + api-key pair to acquire a token, or a pre-acquired bearer token —
// see container.ts). With fake/dead config the office still works: every method
// is wrapped by attendance.service.ts / hr.routes.ts so a network failure,
// timeout, or bad response degrades to {ok:false} / a graceful HTTP status and
// never breaks the room (plan Principle 4: integrations are optional).
//
// FORBIDDEN behaviors (plan.md GreytHR rules) are structurally impossible here:
// there is no timer, no activity listener, and no session reference. checkIn /
// checkOut are pure request/response and are only invoked by an explicit user
// click routed through the attendance service.
//
// ----------------------------- API RESEARCH --------------------------------
// Confirmed against greytHR's official + community docs (June 2026):
//   * Official API portal .................. https://api-docs.greythr.com/
//   * API authentication (readthedocs) ..... https://greythr-api-docs.readthedocs.io/en/latest/authentication.html
//   * API guide / directory (Knit) ......... https://www.getknit.dev/blog/greythr-api-guide
//                                            https://www.getknit.dev/blog/greythr-api-directory-9RnbMR
//   * Attendance API details (greytHR KB) .. https://knowledge.greythr.com/display/GOIN/Attendance+API+Details
//   * Create API key (admin help) .......... https://admin-help.greythr.com/admin/answers/142773372/
//
// DOC-VERIFIED shapes:
//   * Base URL ............ https://api.greythr.com  (a company-domain base such
//                           as https://kalvium.greythr.com also serves the API).
//   * Token endpoint ...... POST /uas/v1/oauth2/client-token using the API
//                           user's client id / credentials. Response is JSON with
//                           access_token, token_type, expires_in (seconds).
//   * Auth header ......... subsequent calls send the token in the ACCESS-TOKEN
//                           header (NOT "Authorization: Bearer"), together with
//                           x-greythr-domain set to the company domain.
//   * Employee lookup ..... GET /employee/v2/employees/lookup?q={email}
//   * Employee by id ...... GET /employee/v2/employees/{employee-id}
//   * Attendance swipe .... POST /v2/attendance/asca/swipes  — swipe entries are
//                           "<ISO datetime>,<employee-code>,<door>,<1=in|0=out>".
//
// VERIFY-WITH-DOCS (tenant/version dependent — isolated as constants below):
//   * Exact field names in the client-token request body (api-user/api-key vs
//     client_id/client_secret) vary by how the API user was provisioned; we send
//     the most widely documented form and keep it in ONE place (TOKEN_PATH +
//     buildTokenBody) so a tenant tweak never touches business logic.
//   * The swipes payload envelope (array of CSV strings under `data` vs a typed
//     object) — see SWIPE_PATH / buildSwipeBody.
//   * Department listing endpoint — see DEPARTMENTS_PATH.
// All such constants are tagged "VERIFY-WITH-DOCS" inline.
// ---------------------------------------------------------------------------

import type { Department } from "@pixeloffice/shared";
import { DEPARTMENTS } from "@pixeloffice/shared";
import {
  HrAdapterError,
  type AttendanceResult,
  type DepartmentMapping,
  type EmployeeRecord,
  type HrAdapter,
} from "./hr-adapter";

// --- endpoint constants (single place to adjust for a tenant) ---------------
/** DOC-VERIFIED: OAuth2 client-token endpoint. */
const TOKEN_PATH = "/uas/v1/oauth2/client-token";
/** DOC-VERIFIED: employee search by email/empno/guid. */
const LOOKUP_PATH = "/employee/v2/employees/lookup";
/** VERIFY-WITH-DOCS: department listing (tenant/version dependent). */
const DEPARTMENTS_PATH = "/employee/v2/departments";
/** DOC-VERIFIED: attendance swipe upload (ASCA). */
const SWIPE_PATH = "/v2/attendance/asca/swipes";

const DEFAULT_TIMEOUT_MS = 5000;
/** Refresh the cached token this many ms BEFORE it actually expires. */
const TOKEN_REFRESH_SKEW_MS = 30_000;
/** Fallback token lifetime if the server omits expires_in. */
const TOKEN_FALLBACK_TTL_MS = 5 * 60_000;

export interface GreytHrConfig {
  /** Domain-scoped base, e.g. https://kalvium.greythr.com or https://api.greythr.com. */
  baseUrl: string;
  /** API user (client id) provisioned in greytHR Settings > API Details. */
  apiUser?: string;
  /** API key (client secret) for that API user. */
  apiKey?: string;
  /**
   * Pre-acquired bearer token. When set, token acquisition is skipped and this
   * value is used directly (legacy GREYTHR_API_TOKEN path). A 401 with a
   * pre-acquired token cannot be auto-refreshed and degrades gracefully.
   */
  apiToken?: string;
  /**
   * Company domain for the x-greythr-domain header. Defaults to the host of
   * baseUrl (e.g. "kalvium.greythr.com").
   */
  domain?: string;
  /** Per-request timeout. Defaults to 5000ms (plan requirement: 5s timeout). */
  timeoutMs?: number;
  /** Injectable fetch for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Injectable clock for tests; defaults to Date.now. */
  now?: () => number;
}

interface CachedToken {
  value: string;
  /** Epoch ms after which the token must be refreshed (already skew-adjusted). */
  refreshAtMs: number;
}

export class GreytHrAdapter implements HrAdapter {
  private readonly baseUrl: string;
  private readonly apiUser?: string;
  private readonly apiKey?: string;
  private readonly staticToken?: string;
  private readonly domain: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  /** Cached access token (when acquired via client-token). */
  private cachedToken: CachedToken | null = null;
  /** In-flight token acquisition, de-duped so concurrent calls share one fetch. */
  private tokenInFlight: Promise<string> | null = null;

  constructor(config: GreytHrConfig) {
    const hasCredentials = Boolean(config.apiUser && config.apiKey);
    const hasStaticToken = Boolean(config.apiToken);
    if (!config.baseUrl || (!hasCredentials && !hasStaticToken)) {
      throw new HrAdapterError(
        "GreytHrAdapter requires baseUrl and either (apiUser + apiKey) or apiToken",
        "config",
      );
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiUser = config.apiUser;
    this.apiKey = config.apiKey;
    this.staticToken = config.apiToken;
    this.domain = config.domain ?? hostOf(this.baseUrl);
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = config.fetchFn ?? fetch;
    this.now = config.now ?? (() => Date.now());
  }

  async lookupEmployee(email: string): Promise<EmployeeRecord | null> {
    const trimmed = (email ?? "").trim();
    if (!trimmed) return null;
    const data = await this.request<unknown>(
      "GET",
      `${LOOKUP_PATH}?q=${encodeURIComponent(trimmed)}`,
    );
    const record = extractFirstEmployee(data);
    if (!record) return null;
    const mapped = mapEmployee(record);
    // An empty id means none of the recognized id-field variants matched — treat
    // it as a miss so a blank employee code is never swiped against attendance.
    return mapped.id ? mapped : null;
  }

  async syncDepartments(): Promise<DepartmentMapping[]> {
    const data = await this.request<unknown>("GET", DEPARTMENTS_PATH);
    const rows = extractDepartments(data);
    return rows.map((label) => ({
      hrDepartment: label,
      officeDepartment: mapDepartment(label),
    }));
  }

  async checkIn(employeeId: string, atMs: number): Promise<AttendanceResult> {
    await this.swipe(employeeId, atMs, /* in */ true);
    return { ok: true, recordedAtMs: atMs, status: "CHECKED_IN" };
  }

  async checkOut(employeeId: string, atMs: number): Promise<AttendanceResult> {
    await this.swipe(employeeId, atMs, /* in */ false);
    return { ok: true, recordedAtMs: atMs, status: "CHECKED_OUT" };
  }

  // --- private --------------------------------------------------------------

  /** Post one attendance swipe (DOC-VERIFIED ASCA endpoint + entry format). */
  private async swipe(employeeId: string, atMs: number, isIn: boolean): Promise<void> {
    await this.request<unknown>("POST", SWIPE_PATH, buildSwipeBody(employeeId, atMs, isIn));
  }

  /**
   * Acquire (and cache) an access token via the client-token endpoint, or return
   * the pre-acquired static token. Refreshes before expiry. Concurrent callers
   * share a single in-flight acquisition.
   */
  private async getToken(forceRefresh = false): Promise<string> {
    if (this.staticToken) return this.staticToken;

    if (!forceRefresh && this.cachedToken && this.now() < this.cachedToken.refreshAtMs) {
      return this.cachedToken.value;
    }
    if (forceRefresh) this.cachedToken = null;

    // De-dupe simultaneous acquisitions.
    if (this.tokenInFlight) return this.tokenInFlight;

    this.tokenInFlight = this.acquireToken()
      .then((tok) => {
        this.cachedToken = tok;
        return tok.value;
      })
      .finally(() => {
        this.tokenInFlight = null;
      });
    return this.tokenInFlight;
  }

  /** POST the client-token endpoint and parse the OAuth2 token response. */
  private async acquireToken(): Promise<CachedToken> {
    const url = `${this.baseUrl}${TOKEN_PATH}`;
    const res = await this.fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        // x-greythr-domain identifies the tenant on every greytHR call.
        "x-greythr-domain": this.domain,
      },
      // VERIFY-WITH-DOCS: client-token request body field names.
      body: JSON.stringify(buildTokenBody(this.apiUser!, this.apiKey!)),
    });
    if (!res.ok) {
      throw new HrAdapterError(`GreytHR token request HTTP ${res.status}`, "http", res.status);
    }
    const json = (await res.json().catch(() => null)) as Json | null;
    const token = json ? str(json.access_token) ?? str(json.accessToken) : null;
    if (!token) {
      throw new HrAdapterError("GreytHR token response missing access_token", "parse");
    }
    // expires_in is seconds per OAuth2; refresh a little early (skew).
    const expiresInSec = typeof json?.expires_in === "number" ? json.expires_in : null;
    const ttlMs = expiresInSec != null ? expiresInSec * 1000 : TOKEN_FALLBACK_TTL_MS;
    // Refresh a little before expiry, but for very short TTLs (<= 2*skew) keep
    // at least half the lifetime so the cache isn't defeated (every call would
    // otherwise re-acquire a token when ttl <= skew).
    const window = ttlMs > TOKEN_REFRESH_SKEW_MS * 2 ? ttlMs - TOKEN_REFRESH_SKEW_MS : Math.floor(ttlMs / 2);
    const refreshAtMs = this.now() + Math.max(0, window);
    return { value: token, refreshAtMs };
  }

  /**
   * Single seam for every authenticated GreytHR HTTP call. Applies the
   * ACCESS-TOKEN + x-greythr-domain headers, JSON body, a 5s AbortController
   * timeout, and ONE token-refresh retry on a 401 (expired token). All failures
   * become typed HrAdapterError (the attendance service catches these and
   * degrades gracefully).
   */
  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const send = async (token: string): Promise<Response> => {
      const url = `${this.baseUrl}${path}`;
      return this.fetchWithTimeout(url, {
        method,
        headers: {
          // DOC-VERIFIED: greytHR expects the token in ACCESS-TOKEN, plus the
          // company domain in x-greythr-domain — NOT Authorization: Bearer.
          "Access-Token": token,
          "x-greythr-domain": this.domain,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    };

    let res = await send(await this.getToken());

    // 401 => token likely expired: refresh once and retry (no-op for static token).
    if (res.status === 401 && !this.staticToken) {
      res = await send(await this.getToken(/* forceRefresh */ true));
    }

    if (!res.ok) {
      throw new HrAdapterError(`GreytHR HTTP ${res.status}`, "http", res.status);
    }

    // Some endpoints (attendance) may return empty bodies on success.
    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HrAdapterError("GreytHR returned non-JSON body", "parse");
    }
  }

  /** fetch + 5s AbortController timeout, mapping aborts/errors to HrAdapterError. */
  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new HrAdapterError(
          `GreytHR request timed out after ${this.timeoutMs}ms`,
          "timeout",
        );
      }
      throw new HrAdapterError(
        `GreytHR network error: ${err instanceof Error ? err.message : String(err)}`,
        "network",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

// --- request body builders (VERIFY-WITH-DOCS: tenant-dependent shapes) -------

/**
 * Client-token request body. greytHR provisions the API user as an OAuth2
 * client; the most widely documented form sends the api user as the client id
 * and the api key as the secret. Kept in one place so a tenant variation never
 * touches the request pipeline.
 */
function buildTokenBody(apiUser: string, apiKey: string): Json {
  return { grant_type: "client_credentials", client_id: apiUser, client_secret: apiKey };
}

/**
 * ASCA swipe body. DOC-VERIFIED entry format:
 *   "<ISO datetime>,<employee-code>,<door>,<1=in|0=out>".
 * VERIFY-WITH-DOCS: the envelope key (`data`) wrapping the CSV entries array.
 */
function buildSwipeBody(employeeCode: string, atMs: number, isIn: boolean): Json {
  const entry = `${new Date(atMs).toISOString()},${employeeCode},Office,${isIn ? 1 : 0}`;
  return { data: [entry] };
}

// --- field mapping helpers (defensive about GreytHR field-name variants) -----

type Json = Record<string, unknown>;

function asJson(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Host portion of a base URL (for the x-greythr-domain header default). */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

/** GreytHR list responses may be `[...]`, `{data:[...]}`, or `{employees:[...]}`. */
function extractFirstEmployee(data: unknown): Json | null {
  if (Array.isArray(data)) return asJson(data[0]) ?? null;
  const obj = asJson(data);
  if (!obj) return null;
  for (const key of ["data", "employees", "results", "items"]) {
    const arr = obj[key];
    if (Array.isArray(arr)) return asJson(arr[0]) ?? null;
  }
  // A single-object response is also acceptable.
  return obj.email || obj.id || obj.employeeId ? obj : null;
}

function mapEmployee(row: Json): EmployeeRecord {
  return {
    id:
      str(row.id) ??
      str(row.employeeId) ??
      str(row.empId) ??
      str(row.employeeNo) ??
      str(row.employeeCode) ??
      "",
    email: str(row.email) ?? str(row.emailId) ?? str(row.officialEmail) ?? "",
    name:
      str(row.name) ??
      str(row.fullName) ??
      [str(row.firstName), str(row.lastName)].filter(Boolean).join(" ").trim() ??
      "",
    department: str(row.department) ?? str(row.departmentName) ?? str(row.dept) ?? "",
  };
}

function extractDepartments(data: unknown): string[] {
  const rows: unknown[] = Array.isArray(data)
    ? data
    : ((asJson(data)?.data ?? asJson(data)?.departments ?? []) as unknown[]);
  const out: string[] = [];
  for (const row of rows) {
    const obj = asJson(row);
    const label = obj
      ? str(obj.name) ?? str(obj.departmentName) ?? str(obj.department)
      : str(row);
    if (label) out.push(label);
  }
  return out;
}

/** Case-insensitive match of a GreytHR label onto an office Department. */
function mapDepartment(label: string): Department | null {
  const want = label.trim().toLowerCase();
  for (const d of DEPARTMENTS) {
    if (d.toLowerCase() === want) return d;
  }
  // A few common aliases GreytHR tenants use.
  const aliases: Record<string, Department> = {
    "software engineering": "Engineering",
    engineering: "Engineering",
    "product management": "Product",
    ux: "Design",
    "human resources": "HR",
  };
  return aliases[want] ?? null;
}
