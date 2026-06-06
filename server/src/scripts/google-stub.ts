// ---------------------------------------------------------------------------
// Google API STUB — local stand-in for the three Google bases, for testing
// the Google Workspace (Calendar -> Presence + Meet) integration WITHOUT real
// Google credentials or network egress.
//
// It impersonates, on ONE port (default 9925, env GOOGLE_STUB_PORT):
//   - GOOGLE_AUTH_BASE   (default https://accounts.google.com)
//       GET  /o/oauth2/v2/auth
//   - GOOGLE_TOKEN_BASE  (default https://oauth2.googleapis.com)
//       POST /token
//   - GOOGLE_API_BASE    (default https://www.googleapis.com)
//       GET  /oauth2/v3/userinfo, GET /oauth2/v2/userinfo
//       GET  /calendar/v3/calendars/primary/events
//
// Point the server (and the calendar adapter / oauth provider) at it by setting:
//   GOOGLE_AUTH_BASE=http://localhost:9925
//   GOOGLE_TOKEN_BASE=http://localhost:9925
//   GOOGLE_API_BASE=http://localhost:9925
//
// Pure test scaffolding — never imported by the app, never shipped. The real
// Google semantics live in the adapter; this just emits deterministic traffic
// so the adapter's filtering runs against real HTTP.
//
// Env knobs:
//   GOOGLE_STUB_PORT        listen port (default 9925)
//   GOOGLE_STUB_NO_CURRENT  "1" => omit the in-progress event (only upcoming),
//                           so tests can assert the NOT-in-meeting state.
// ---------------------------------------------------------------------------

import express, { type Request, type Response } from "express";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.GOOGLE_STUB_PORT ?? 9925);
const NO_CURRENT = process.env.GOOGLE_STUB_NO_CURRENT === "1";

const app = express();
// Google's /token is application/x-www-form-urlencoded; userinfo/calendar are GET.
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// One log line per request so the runner can see the auth/token/calendar dance.
app.use((req: Request, _res: Response, next: () => void) => {
  console.log(`[google-stub] ${req.method} ${req.originalUrl}`);
  next();
});

function rand(): string {
  return randomBytes(8).toString("hex");
}

// --------------------------- AUTH base ------------------------------------
// GET /o/oauth2/v2/auth — auto-approve: immediately 302 back to redirect_uri
// with a stub code + the original state. ?manual=1 renders an HTML consent page
// with an "Approve" link instead (for humans poking at it in a browser).
app.get("/o/oauth2/v2/auth", (req: Request, res: Response) => {
  const redirectUri = String(req.query.redirect_uri ?? "");
  const state = req.query.state == null ? "" : String(req.query.state);
  const code = `stub-code-${rand()}`;

  if (!redirectUri) {
    res.status(400).send("missing redirect_uri");
    return;
  }

  const target = new URL(redirectUri);
  target.searchParams.set("code", code);
  if (state) target.searchParams.set("state", state);

  if (req.query.manual === "1") {
    res
      .status(200)
      .type("html")
      .send(
        `<!doctype html><html><body style="font-family:monospace">` +
          `<h2>Google STUB consent</h2>` +
          `<p>scope: ${escapeHtml(String(req.query.scope ?? ""))}</p>` +
          `<p><a href="${escapeHtml(target.toString())}">Approve</a></p>` +
          `</body></html>`,
      );
    return;
  }

  res.redirect(302, target.toString());
});

// --------------------------- TOKEN base -----------------------------------
// POST /token — handle authorization_code and refresh_token grants.
app.post("/token", (req: Request, res: Response) => {
  const grant = String(req.body?.grant_type ?? "");
  const scope = String(req.body?.scope ?? "openid email profile");

  if (grant === "authorization_code") {
    res.json({
      access_token: `stub-access-${rand()}`,
      refresh_token: `stub-refresh-${rand()}`,
      expires_in: 3600,
      token_type: "Bearer",
      scope,
    });
    return;
  }

  if (grant === "refresh_token") {
    // Refresh returns a fresh access token; Google does NOT re-issue a refresh
    // token here, and omits `scope` only sometimes — we echo it for convenience.
    res.json({
      access_token: `stub-access-${rand()}`,
      expires_in: 3600,
      token_type: "Bearer",
      scope,
    });
    return;
  }

  res.status(400).json({ error: "unsupported_grant_type", grant_type: grant });
});

// --------------------------- API base -------------------------------------
// userinfo — fixed test identity (both v2 and v3 paths).
function userinfo(_req: Request, res: Response): void {
  res.json({
    sub: "stub-user",
    email: "tester@kalvium.com",
    email_verified: true,
    name: "Stub Tester",
    picture: "",
  });
}
app.get("/oauth2/v3/userinfo", userinfo);
app.get("/oauth2/v2/userinfo", userinfo);
// openidconnect host path the existing provider also uses, just in case it is
// pointed here via GOOGLE_API_BASE.
app.get("/v1/userinfo", userinfo);

// calendar events — deterministic fixture exercising every adapter filter.
// timeMin/timeMax are accepted but ignored (filtering correctness is the
// adapter's job and is unit-tested); we just emit a realistic mixed list.
app.get("/calendar/v3/calendars/primary/events", (_req: Request, res: Response) => {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const dateOnly = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  const items: unknown[] = [];

  // (1) Happening NOW — started 5 min ago, ends in 25 min. Has Meet link.
  //     This is what should drive IN_MEETING + the Join Meet button.
  if (!NO_CURRENT) {
    items.push({
      id: "evt-current",
      status: "confirmed",
      summary: "Design Sync",
      start: { dateTime: iso(now - 5 * 60_000) },
      end: { dateTime: iso(now + 25 * 60_000) },
      hangoutLink: "https://meet.google.com/stub-meet-link",
      conferenceData: {
        conferenceSolution: { key: { type: "hangoutsMeet" } },
        entryPoints: [
          { entryPointType: "video", uri: "https://meet.google.com/stub-meet-link" },
        ],
      },
      attendees: [{ self: true, responseStatus: "accepted" }],
    });
  }

  // (2) Upcoming in 2h — confirmed, should NOT count as current.
  items.push({
    id: "evt-upcoming",
    status: "confirmed",
    summary: "Roadmap Review",
    start: { dateTime: iso(now + 2 * 60 * 60_000) },
    end: { dateTime: iso(now + 3 * 60 * 60_000) },
    hangoutLink: "https://meet.google.com/stub-upcoming-link",
    attendees: [{ self: true, responseStatus: "accepted" }],
  });

  // (3) All-day event (date, not dateTime) — must be skipped by the adapter.
  items.push({
    id: "evt-allday",
    status: "confirmed",
    summary: "Company Holiday",
    start: { date: dateOnly(now) },
    end: { date: dateOnly(now + 24 * 60 * 60_000) },
  });

  // (4) Cancelled overlapping-now event — must be skipped.
  items.push({
    id: "evt-cancelled",
    status: "cancelled",
    summary: "Cancelled Standup",
    start: { dateTime: iso(now - 10 * 60_000) },
    end: { dateTime: iso(now + 10 * 60_000) },
    attendees: [{ self: true, responseStatus: "accepted" }],
  });

  // (5) transparency=transparent overlapping-now event ("free") — must be skipped.
  items.push({
    id: "evt-transparent",
    status: "confirmed",
    summary: "Free Block",
    transparency: "transparent",
    start: { dateTime: iso(now - 2 * 60_000) },
    end: { dateTime: iso(now + 20 * 60_000) },
    attendees: [{ self: true, responseStatus: "accepted" }],
  });

  res.json({
    kind: "calendar#events",
    timeZone: "UTC",
    nextSyncToken: `stub-sync-${rand()}`,
    items,
  });
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

app.listen(PORT, () => {
  console.log(
    `[google-stub] listening on http://localhost:${PORT} ` +
      `(NO_CURRENT=${NO_CURRENT ? "1" : "0"}) — ` +
      `set GOOGLE_AUTH_BASE/GOOGLE_TOKEN_BASE/GOOGLE_API_BASE to this origin`,
  );
});
