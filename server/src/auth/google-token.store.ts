// ---------------------------------------------------------------------------
// Google Calendar refresh-token store (per stable user identity).
//
// The Calendar integration needs a SEPARATE offline grant from sign-in: the
// GoogleOAuthProvider sign-in requests `access_type=online` and discards tokens,
// so the calendar connect flow performs its own incremental authorization
// (`access_type=offline` + `prompt=consent`) and persists the resulting refresh
// token here, keyed by the stable `identity.userId`.
//
// Framework-free: no Express, no Colyseus, no Google SDK — a plain interface +
// an in-memory default. The interface is the seam a production deployment swaps
// for an ENCRYPTED-AT-REST database store (refresh tokens are long-lived bearer
// secrets and MUST be encrypted at rest in production — the in-memory impl is
// dev-only and loses tokens on restart).
//
// PRIVACY: we store ONLY the OAuth refresh token (and an optional scope/email
// hint for diagnostics). We never store calendar event bodies, titles, or
// attendee lists here — those are read transiently and only what the presence
// product displays (no-surveillance constitution).
// ---------------------------------------------------------------------------

/** The persisted record for one connected user's calendar grant. */
export interface GoogleTokenRecord {
  /** Long-lived OAuth refresh token (offline grant). The only required field. */
  refreshToken: string;
  /** Space-delimited scopes the grant carries (diagnostics only). */
  scope?: string;
  /** Best-effort account email the grant belongs to (diagnostics only). */
  email?: string;
  /** When the record was saved (epoch ms). */
  connectedAtMs?: number;
}

export interface GoogleTokenStore {
  /** Persist (or overwrite) the calendar grant for a stable user identity. */
  save(userId: string, record: GoogleTokenRecord): void | Promise<void>;
  /** The stored record for a user, or null when not connected. */
  get(userId: string): GoogleTokenRecord | null | Promise<GoogleTokenRecord | null>;
  /** Remove a user's grant (disconnect). */
  delete(userId: string): void | Promise<void>;
  /** All currently-connected user identities (drives the poll loop). */
  connectedUserIds(): string[] | Promise<string[]>;
}

/**
 * In-memory token store (DEV DEFAULT). Tokens live only for the process
 * lifetime. In production, replace with an encrypted-at-rest DB-backed store
 * implementing the same interface (refresh tokens are bearer secrets).
 */
export class InMemoryGoogleTokenStore implements GoogleTokenStore {
  private readonly records = new Map<string, GoogleTokenRecord>();

  save(userId: string, record: GoogleTokenRecord): void {
    this.records.set(userId, {
      ...record,
      connectedAtMs: record.connectedAtMs ?? Date.now(),
    });
  }

  get(userId: string): GoogleTokenRecord | null {
    return this.records.get(userId) ?? null;
  }

  delete(userId: string): void {
    this.records.delete(userId);
  }

  connectedUserIds(): string[] {
    return [...this.records.keys()];
  }
}
