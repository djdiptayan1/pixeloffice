// HrAdapter that records explicit check-in/out against the self-hosted greytHR
// ESS API (POST /api/attendance/sign-in|out), authenticated with the per-user
// session captured at login. Failures are returned, never thrown.

import type { GreytHrSessionStore } from "../../auth/greythr/greythr-session.store";
import type {
  AttendanceResult,
  DepartmentMapping,
  EmployeeRecord,
  HrAdapter,
} from "./hr-adapter";

interface GreytHrAttendanceData {
  status?: "CHECKED_IN" | "CHECKED_OUT";
  recordedAtMs?: number;
}

interface GreytHrEnvelope<T> {
  success: boolean;
  data: T | null;
  error: { code?: string; message?: string } | null;
}

export interface GreytHrEssAttendanceAdapterConfig {
  baseUrl: string;
  sessions: GreytHrSessionStore;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 8000;

export class GreytHrEssAttendanceAdapter implements HrAdapter {
  private readonly baseUrl: string;
  private readonly sessions: GreytHrSessionStore;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(config: GreytHrEssAttendanceAdapterConfig) {
    if (!config.baseUrl) {
      throw new Error("GreytHrEssAttendanceAdapter requires a baseUrl");
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.sessions = config.sessions;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = config.fetchFn ?? globalThis.fetch;
  }

  /** Not used on the ESS path: greytHR identifies the employee from the session. */
  async lookupEmployee(_email: string): Promise<EmployeeRecord | null> {
    return null;
  }

  /** Department sync is handled by the login/account flow, not attendance. */
  async syncDepartments(): Promise<DepartmentMapping[]> {
    return [];
  }

  /** Record an explicit check-in for the user. */
  async checkIn(userId: string, atMs: number): Promise<AttendanceResult> {
    return this.swipe(userId, atMs, "sign-in", "CHECKED_IN");
  }

  /** Record an explicit check-out for the user. */
  async checkOut(userId: string, atMs: number): Promise<AttendanceResult> {
    return this.swipe(userId, atMs, "sign-out", "CHECKED_OUT");
  }

  /** POST the swipe with the user's session; degrade to {ok:false} on any failure. */
  private async swipe(
    userId: string,
    atMs: number,
    action: "sign-in" | "sign-out",
    intended: "CHECKED_IN" | "CHECKED_OUT",
  ): Promise<AttendanceResult> {
    const sessionId = this.sessions.get(userId);
    if (!sessionId) {
      return {
        ok: false,
        recordedAtMs: atMs,
        status: intended,
        reason: "Sign in with greytHR to record attendance.",
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/api/attendance/${action}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${sessionId}`,
        },
        signal: controller.signal,
      });
    } catch (err) {
      const reason =
        err instanceof Error && err.name === "AbortError"
          ? `greytHR attendance timed out after ${this.timeoutMs}ms`
          : `greytHR attendance network error: ${err instanceof Error ? err.message : String(err)}`;
      return { ok: false, recordedAtMs: atMs, status: intended, reason };
    } finally {
      clearTimeout(timer);
    }

    let envelope: GreytHrEnvelope<GreytHrAttendanceData> | null = null;
    try {
      envelope = (await res.json()) as GreytHrEnvelope<GreytHrAttendanceData>;
    } catch {
      envelope = null;
    }

    if (!res.ok || !envelope || !envelope.success || !envelope.data) {
      const code = envelope?.error?.code;
      let reason = envelope?.error?.message ?? `greytHR attendance HTTP ${res.status}`;
      if (res.status === 401 || code === "UNAUTHORIZED" || code === "SESSION_EXPIRED") {
        this.sessions.delete(userId);
        reason = "greytHR session expired. Sign in again to record attendance.";
      }
      return { ok: false, recordedAtMs: atMs, status: intended, reason };
    }

    const data = envelope.data;
    return {
      ok: true,
      recordedAtMs: typeof data.recordedAtMs === "number" ? data.recordedAtMs : atMs,
      status: data.status ?? intended,
    };
  }
}
