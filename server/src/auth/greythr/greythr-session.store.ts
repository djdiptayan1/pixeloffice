// Per-user greytHR ESS session store: login writes the session id, the
// attendance adapter reads it to swipe. In-memory dev default.

export interface GreytHrSessionStore {
  set(userId: string, sessionId: string): void;
  get(userId: string): string | null;
  delete(userId: string): void;
}

export class InMemoryGreytHrSessionStore implements GreytHrSessionStore {
  private readonly sessions = new Map<string, string>();

  set(userId: string, sessionId: string): void {
    this.sessions.set(userId, sessionId);
  }

  get(userId: string): string | null {
    return this.sessions.get(userId) ?? null;
  }

  delete(userId: string): void {
    this.sessions.delete(userId);
  }
}
