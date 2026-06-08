# PixelOffice — Integrations & Capability Roadmap

> Decision-ready synthesis of six research tracks (A/V, team-comms, productivity suites,
> enterprise identity, engagement, infra/analytics), cross-checked against live 2026
> primary sources and the actual codebase seams (`CONTRACT.md`, `server/src/integrations/*`,
> `server/src/auth/*`). Every nontrivial claim is sourced inline like `[1]`.
>
> Governing constitution (`plan.md`): **presence, not surveillance** — no keystroke/mouse/
> screenshot tracking, no productivity scoring; **human agency** — never auto-move/auto-act;
> **integrations optional** — the office must keep working if any integration fails.

---

## 1. Executive summary — the 5 highest-leverage moves

1. **Proximity voice (LiveKit, audio-only)** — closes the #1 gap vs Gather/Kumospace.
   Proximity is computed in *our* client from existing avatar tile coords; LiveKit is a
   swappable transport behind a new `AvAdapter` seam. Self-hostable, so no lock-in. `[1][2][3]`
2. **Google `focusTime`/`outOfOffice` → FOCUS/AWAY presence** — highest impact-per-effort:
   zero new integration, zero new scope; just richer mapping inside the *existing* Google
   calendar adapter. Makes our signature FOCUS state auto-derived from a user-authored block. `[10][11]`
3. **Microsoft 365 Outlook calendar adapter** — biggest market-coverage win (Google vs M365
   split). Auth is ~90% done (`MicrosoftOAuthProvider` exists); add one scope + one
   `CalendarAdapter` impl using Graph `/me/calendarView`. `[12][13]`
4. **Slack presence mirror + announcements** — "your office status follows you into Slack"
   (`users.profile.set`, per-user OAuth, constitution-clean) plus `chat.postMessage`
   coffee-break/town-hall posts with a deep-link Join button (human agency). `[6][7][8]`
5. **Privacy-safe admin/security audit log** — enterprise procurement ranks it #2 (before SSO);
   gates SOC 2. Logs *config/security events only* (logins, role/connection/SCIM changes) —
   explicitly NOT movement/activity. The scope decision is load-bearing. `[18][19]`

---

## 2. Prioritized opportunity table

| Opportunity | Impact | Effort | Maps to seam | Constitution-safe? | One-line how |
|---|---|---|---|---|---|
| Reactions / confetti | High | S | extend `EMOTE` broadcast | Yes (ephemeral) | New emoji in `EMOTE_EMOJI`, store-nothing broadcast |
| Custom status message | High | S | extend `SET_STATUS`/`PlayerSnapshot` | Yes (user-set only) | Optional free-text on presence; never inferred |
| Google focusTime/OOO → FOCUS/AWAY | High | S–M | existing Google `CalendarAdapter` | Yes (user-authored block) | Map `eventType` + add `kind` discriminator |
| Shared Pomodoro/focus timer | High | M | `ActiveGame`/`GAME_UPDATE` pattern | Yes if never scored | Server-authoritative countdown → FOCUS (MANUAL source) |
| M365 Outlook calendar adapter | High | M | `CalendarAdapter` + `MicrosoftOAuthProvider` | Yes (read-only own cal) | Graph `/me/calendarView`, scope `Calendars.ReadBasic` |
| Slack announcements + Join deep-link | High | S | new `NotificationAdapter` | Yes (push + click) | `chat.postMessage` + Block Kit button |
| Slack status mirror | High | M | new `PresenceMirrorAdapter` | Yes (user sets own status) | `users.profile.set`, per-user OAuth, TTL expiry |
| Guest / visitor links | High | M | `AuthProvider` (`GuestAuthProvider`) | Yes (scope guest visibility) | Short-lived scoped JWT via existing `jwt.service` |
| Proximity VOICE (LiveKit) | High | L | new `AvAdapter` | Yes (opt-in, no recording) | LiveKit transport + client Web Audio gain |
| Knock-to-enter / lockable rooms | Med | M | plain JSON messages | Yes (reinforces agency) | `KNOCK` msg + server area-lock state |
| Embedded whiteboard (Excalidraw) | High | L | client React island + Colyseus sync | Yes | MIT pkg; multiplayer via our JSON deltas |
| MS Teams 2-way presence sync | High | L | `PresenceMirrorAdapter` | Yes (delegated consent) | Graph `setUserPreferredPresence` + read |
| MS Graph Presence read | High | L | new presence source `TEAMS` | Needs guardrails | `/me/presence`; render-and-discard, no history |
| Privacy-safe audit log | High | M | new `AuditLog` interface | Yes if event-allowlisted | Log config/security events only |
| True spatial stereo audio | Med | M | extends `AvAdapter` client | Yes | Swap GainNode → PannerNode (relative pos) |
| Screen share (meeting anchors) | High | M | `AvAdapter` | Yes (explicit click) | LiveKit screen-share, gated to seated users |
| Discord webhooks + slash commands | Med | S | `NotificationAdapter` | Yes (push only) | Incoming webhook + HTTP interactions endpoint |
| Teams channel announcements | Med | M | `NotificationAdapter` | Yes | Workflows webhook / Graph `chatMessage` (RSC) |
| Watercooler prompts | Med | S | existing toast/event plumbing | Yes | Server picks prompt → toast Coffee Area |
| Generic SAML 2.0 SP | High | L | `AuthProvider` + org model | Yes (auth, not tracking) | `@node-saml/node-saml`, no passport |
| Generic OIDC discovery | Med | M | `OAuthProvider` + org model | Yes | `openid-client` v6 discovery |
| SCIM 2.0 provisioning | Med | L | `UserRepository` + org model | Yes (identity only) | SCIMMY + routers, per-org bearer |
| Per-org RBAC | Med | M | `rbac.ts` | Yes (no member surveillance) | Roles scoped to org membership |
| Multi-tenant Organization model | High | XL | user store + RBAC + routing | Yes | Org entity + per-org connection config |
| Optional proximity VIDEO | Med | L | `AvAdapter` | Yes (default OFF) | Opt-in webcam within tight radius |
| PWA + tasteful web push | Med | M | client; `manifest`/SW | Yes (recipient pull) | `vite-plugin-pwa` + VAPID; push needs PWA on iOS |
| Plausible analytics | Med | S–M | new `AnalyticsAdapter` | Yes (aggregate only) | Cookieless, no PII, no per-user dossier |
| Sentry error tracking | Med | S | `ObservabilityAdapter` | Yes if Replay OFF | Errors only; `sendDefaultPii:false` |
| Colyseus horizontal scaling | High | L–XL | `Server` driver/presence + room sharding | Yes | RedisDriver + RedisPresence + shard office rooms |
| Persistent sticky notes/posters | Med | L | per-floor object store (Postgres opt.) | Yes | Server-stored object list broadcast on join |
| Ambient soundscape toggle | Low | S | `ui/settings.ts` only | Yes (client-only) | Settings toggle + audio loop |
| Self-host LiveKit OSS | Low | XL | same `AvAdapter` | Yes | Only >~500 CCU; identical SDK, no rewrite |
| Zoom meeting create (link-out) | Med | M | `MeetingInfo.meetLink` | Yes (no auto-join) | `POST /users/me/meetings`; link-out only |
| Agora 3D Spatial Audio ext. | Low | M | — | n/a | SKIP: ~17-stream cap, black-box, lock-in |
| Read external presence into office | Low | M | — | Risky | Opt-in display-only at best; inverts value prop |
| Discord user presence read | Low | M | — | **No** | SKIP: privileged intent = passive scraping |
| Notion/Linear/Jira/GitHub presence | Low | M | — | **No** | SKIP: only derivable via activity tracking |

---

## 3. Now / Next / Later

**NOW** — high-impact, S/M effort, reuses existing seams, constitution-clean:
- Reactions/confetti; custom status message; watercooler prompts (extend `EMOTE`/`SET_STATUS`/toast).
- Google `focusTime`/`outOfOffice` → FOCUS/AWAY (extend existing Google adapter; add a
  `kind: "meeting"|"focus"|"ooo"` discriminator on the `CalendarAdapter` return). `[10][11]`
- M365 Outlook calendar adapter (Graph `/me/calendarView`, scope `Calendars.ReadBasic`). `[12][13]`
- Slack announcements + Join deep-link (`chat.postMessage`); single-workspace app installs with no review. `[7][8]`
- Shared Pomodoro/focus timer (server-authoritative countdown → FOCUS via MANUAL source).
- Plausible analytics behind `AnalyticsAdapter` (Noop default); Sentry errors-only. `[20][22]`

**NEXT** — high value, L effort or one new dependency / per-org token storage:
- **Proximity VOICE via LiveKit** (the top pick — deep-dive §4). `[1][2][3]`
- Slack status mirror + MS Teams 2-way presence sync (per-user OAuth token storage). `[6][9][14]`
- Guest/visitor links (`GuestAuthProvider` behind existing `AuthProvider`).
- Knock-to-enter / lockable private rooms (plain JSON; reinforces agency).
- Embedded whiteboard (Excalidraw MIT; React island + Colyseus sync). `[15]`
- Screen share + true spatial stereo (incremental on the `AvAdapter` once voice lands).
- Privacy-safe audit log (event-allowlisted). `[18][19]`

**LATER** — XL platform bets / only at scale:
- Multi-tenant Organization model + generic SAML/OIDC SSO + SCIM (prerequisite: the org model). `[16][17][19]`
- Colyseus horizontal scaling: RedisDriver + RedisPresence **and** shard the single
  `OfficeRoom` into per-floor/per-zone/per-org rooms (one room is pinned to one core). `[23][24]`
- Self-host LiveKit OSS (only >~500 CCU; identical SDK, migrate without rewrite). `[5]`
- Persistent sticky notes/posters; optional proximity video; PWA + web push; Zoom link-out.

---

## 4. Deep-dive: TOP PICK — Proximity spatial voice (then video)

**Why this is the pick.** Real-time A/V + proximity audio is the single biggest feature gap
vs every competitor (Gather, Kumospace, Teamflow) and the largest retention driver. The repo
has **no media/WebRTC layer at all** — greenfield behind one adapter seam.

### 4.1 The key architectural fact
Proximity/spatial audio is **not** a server feature you buy — it is a **client-side Web Audio
API graph** driven by *our existing avatar coordinates*. The SFU only delivers raw
`MediaStreamTrack`s; *we* compute volume/pan from tile distance. Two tiers `[2]`:
- **Proximity volume** (what Gather actually does — distance-attenuated gain, NOT truly
  spatialized `[4]`): one `GainNode` per remote participant, `gain = falloff(distance)`. **Target this first.**
- **True spatial** (stereo pan): feed each remote track into a `PannerNode` with
  `position = remotePos − myPos` (LiveKit's official tutorial: `distanceModel:"exponential"`). `[2]`

Consequence: proximity logic lives in *our* client, fed by the same x/y tile coords already
flowing through `onLocalMove`/`PLAYER_MOVED` (`CONTRACT.md`). The provider is swappable transport.

### 4.2 Recommended provider — LiveKit (Cloud first, OSS self-host as escape hatch)
LiveKit is the only provider that is **both managed AND self-hostable with identical code**,
preserving "integrations optional / no lock-in." It exposes the three primitives proximity needs:
`RemoteTrackPublication.track.mediaStreamTrack`, per-participant `track.setVolume(0..1)`, and
selective subscription (`autoSubscribe:false` + `setSubscribed`/`setEnabled`) so we only pull
tracks for avatars within `HEAR_RADIUS` — caps bandwidth/CPU regardless of office size. `[1][3]`
Clean Node/TS server SDK (`livekit-server-sdk` v2.x: `AccessToken` grants + `RoomServiceClient`)
slots beside our existing JWT/RBAC for token minting. Daily is faster to ship but managed-only
(no self-host escape); Agora's packaged spatializer caps ~17 streams + black-box → skip;
Twilio Video (near-EOL, reversed) and Vonage (legacy) → skip; self-hosting mediasoup only pays
off >~500 CCU → defer. `[1]`

### 4.3 Minimal architecture (respects CONTRACT.md seams)
1. **Server adapter** `server/src/integrations/av/av-adapter.ts` mirroring `CalendarAdapter`/
   `HrAdapter`: `AvAdapter { mintToken(userId, roomName, grants): Promise<string|null>; isEnabled(): boolean }`.
   Impls: `LiveKitAvAdapter` (uses `livekit-server-sdk AccessToken`) and `NullAvAdapter`
   (returns `null` → A/V silently disabled). Container picks via env (`LIVEKIT_URL`/`API_KEY`/
   `SECRET`), exactly like the Google calendar env-gating already in place.
2. **Protocol** (one backward-compatible addition): `C2S.REQUEST_AV_TOKEN` → `S2C.AV_TOKEN { url, token }`.
   Room = a **single office-wide LiveKit room** (proximity, NOT per-meeting rooms). Token gated by existing RBAC/JWT.
3. **Client A/V manager** `client/src/av/proximity-audio.ts` (UI layer, NOT `game/` — keep the
   render layer business-logic-free per CONTRACT). `Room.connect(url, token)` with
   `autoSubscribe:false`; one `AudioContext`; per remote → `MediaStreamSource → GainNode (→ optional PannerNode) → destination`.
4. **Drive from existing movement.** On each position update, for each remote:
   `dist = tileDistance(me, them); gain = dist<=HEAR_RADIUS ? falloff(dist) : 0`. Use
   `setSubscribed`/`setEnabled` with hysteresis. **No new server traffic — reuse coords already on the wire.**
5. **Tests.** Keep `falloff(distance) → gain` and subscribe/unsubscribe-at-radius transitions in
   a framework-free module with vitest state-transition tests (satisfies the "test state transitions" rule).

### 4.4 Pricing at ~100 concurrent audio users `[1]`
- LiveKit tiers (verified live, Jun 2026): **Build $0** (5,000 WebRTC min, 100 concurrent, 50GB
  downstream); **Ship $50/mo** (150,000 min, 1,000 concurrent, 250GB then **$0.12/GB**); **Scale $500/mo**
  (1.5M min, 5,000 concurrent, 3TB then **$0.10/GB**). Upstream bandwidth is free in 2026.
- 100 users × 60 min = 6,000 participant-min/hr. Free tier's 5,000-min cap is too small for
  sustained use → realistic floor = **Ship $50/mo base** (covers ~150k min ≈ a ~100-person office
  used a few hours/day) **or self-host**. Audio-only is the cheapest and lowest-CPU starting point.
- Self-host (LiveKit OSS) has no per-min/participant cap — a 4-vCPU/16GB box handles 200+
  participants — but only worth it above ~500 CCU once eng time is priced. Document it; don't build now. `[5]`

### 4.5 Privacy stance (mandatory — A/V is the most surveillance-adjacent feature)
- **Mic OFF by default**; explicit "Join voice" click (human agency, mirrors click-to-Join-meeting).
  Proximity may auto-adjust incoming **volume**, but must **never auto-publish** the user's own mic.
- **No recording/egress** of any kind (LiveKit egress stays off) — recording a virtual office is
  exactly the surveillance the constitution forbids. No audio-level logging, no who-talked-to-whom
  analytics, no speaking-time scoring.
- Visible mic-on / camera-on indicators on avatars (real-time consent cue, not persisted).
- One-click global "Disable voice/video entirely" in Settings (persists). **Video default OFF.**
- Env-gated + try/caught: token-mint failure shows a toast and the office keeps fully working.

### 4.6 MVP breakdown (S/M/L)
- **S** — `AvAdapter` interface + `NullAvAdapter`; env detection; `REQUEST_AV_TOKEN`/`AV_TOKEN`
  protocol; framework-free `falloff()` + tests.
- **M** — `LiveKitAvAdapter` token mint; client connect + per-participant `GainNode`; drive gain
  from `PLAYER_MOVED`; selective subscribe within `HEAR_RADIUS`; mic toggle + Join-voice UX + indicators.
- **L** — true spatial `PannerNode`; screen-share gated to meeting-room anchors; optional opt-in
  proximity video; settings persistence; self-host docs.

---

## 5. Comms presence sync (Slack / Teams) — unlocks adoption

Build a generic `NotificationAdapter` (post announcement + deep-link builder) and a
`PresenceMirrorAdapter` (push our office state → external status), both env-gated + DI-wired
exactly like `CalendarAdapter` (mock + real impls).

- **Slack (highest ROI, lowest friction).** `chat.postMessage` + Block Kit (scope `chat:write`)
  for coffee-break/town-hall posts with a "Join the office" deep-link button — far better than
  channel-locked incoming webhooks (Slack's own docs say webhooks are one-way-alerts only). `[7][8]`
  Status mirror via `users.profile.set` (`users.profile:write`, **user token**) sets
  `status_text`/`status_emoji`/`status_expiration` (TTL) — FOCUS/BREAK/IN_MEETING map 1:1 with
  auto-clear. Per-user OAuth = constitution-clean (user sets their *own* status). Single-workspace
  internal apps install with **no Slack review**. Note: `users.setPresence` only accepts
  `auto`/`away`, so the rich value is custom STATUS, not the presence dot. `[6]`
- **Teams (highest technical prize, highest effort).** Graph `setUserPreferredPresence`
  (`Presence.ReadWrite`, delegated) gives **true 2-way** sync: FOCUS→DoNotDisturb,
  BREAK→BeRightBack/Away, IN_MEETING→Busy, with ISO-8601 expiry. Gotcha: write only takes effect
  if the user already has a live Teams/app presence session. `[14]` Read via `/me/presence`
  (`Presence.Read`). Channel posts: legacy connector webhooks **retire May 18–22 2026** `[9]` —
  build on Power Automate Workflows (note: **MessageCards can't render interactive buttons** —
  use Adaptive Cards) or Graph `POST /teams/{id}/channels/{id}/messages` (RSC consent). `[9][13]`
- **Discord (cheap announcements only).** Incoming webhooks (zero-OAuth) + HTTP slash commands
  (Ed25519-verified, no persistent gateway). **No** way to set a user's Discord status; reading
  presence needs a privileged intent → **skip presence sync** (surveillance-adjacent).

**Sequencing:** Slack announcements (S) → Slack status mirror + Teams 2-way presence (M/L) →
Discord/Teams channel posts (S/M).

---

## 6. Enterprise readiness (SSO / SCIM / audit) — unlocks buyers

Procurement enforces this order: **RBAC → audit logs → SSO → SCIM**; a SOC 2 Type II report is
the gating artifact. `[18][19]` The architectural win already in the repo: the app mints its **own**
JWT after IdP exchange (`jwt.service.ts`), so SAML/OIDC/SCIM all normalize into `OAuthIdentity`/
`SessionClaims` and nothing downstream changes.

- **Audit log (do first — #2 priority).** Privacy-safe = log **security/config events only**
  (logins, role changes, SSO/SCIM connection edits, provision/deprovision, calendar connect,
  admin map edits), customer-queryable + exportable. **MUST NOT** log movement, location traces,
  who-spoke-to-whom, or focus/break durations — that scope decision is load-bearing.
- **Multi-tenant Organization model (the prerequisite, XL).** Today users + RBAC are global
  (env `ADMIN_EMAILS`). Need an Organization entity, per-org IdP connection config, email-domain→org
  routing, and per-org roles. Every SSO/SCIM feature is blocked on this. `[17]`
- **Generic SAML 2.0 SP (L).** `@node-saml/node-saml` v5.1.0 (no passport — the app already avoids
  it) validates signed/encrypted assertions; slots into the existing signed-state + mint-our-JWT
  flow. `[16]`
- **Generic OIDC (M).** `openid-client` v6 discovery for arbitrary IdPs (Okta/Auth0/Ping); the
  existing fetch adapters already cover Google/Entra.
- **SCIM 2.0 (L, add when a customer asks).** SCIMMY v1.3.5 + routers handle the RFC-7644
  PATCH/filter/schema parts hand-rolled SCIM gets wrong. Needs `UserRepository` extended with
  `active`/`externalId`/`orgId` + per-org bearer auth. `[19]`

---

## 7. What we will NOT build (rejected — violate presence-not-surveillance)

These are named so they are **explicitly out of scope**, not accidentally omitted:

- **Productivity scoring / time-in-state aggregates** — % busy, % in meetings, focus-time
  leaderboards, "output ranking." Forbidden by Principle 2.
- **Activity heatmaps / movement traces** — persisting where avatars go, dwell-time maps,
  who-was-near-whom social graphs. Presence is render-and-discard.
- **Keystroke / mouse / global input idle-detection** — OS-level input hooks. (Browser
  `visibilitychange`/Page Visibility for tab-hidden is acceptable; global OS hooks are not.)
- **Screenshot / screen capture** — automatic screenshotting is forbidden. A user-initiated
  **screen-SHARE** is fine; auto-capture/recording-by-default is not.
- **A/V recording / egress by default**, audio-level logging, speaking-time scoring.
- **Auto-status from tickets/commits/PRs** (Notion/Linear/Jira/GitHub/GitLab/Todoist/Asana) —
  none expose presence; the only way to synthesize it is activity tracking. Only acceptable form
  is a manual, user-typed status note never auto-derived from third-party events.
- **Reading external presence into the office to drive behavior** (Slack/Teams/Discord) beyond
  opt-in, display-only, ephemeral decoration; **Discord presence-read skipped entirely** (privileged
  intent = passive scraping).
- **PostHog autocapture / session replay / per-person profiles**, **Sentry Session Replay** —
  these record colleagues' behavior/screens. Analytics must be aggregate/anonymous (Plausible) and
  errors-only (Sentry with `sendDefaultPii:false`, Replay OFF).
- **Auto-move / auto-join / follow-and-teleport** — meetings/events never teleport an avatar; "follow
  a teammate" only as a request-to-accept camera-follow, never moving the followed person.
- **Admin tokens setting other users' status on their behalf** (Slack admin / Graph
  `Presence.ReadWrite.All` app perm) — delegated/user tokens only, or it becomes coercive.

---

## 8. Sources (deduped, annotated)

1. https://livekit.com/pricing — LiveKit 2026 tiers (Build $0 / Ship $50 / Scale $500; 100/1,000/5,000
   concurrent; $0.12→$0.10/GB downstream; upstream free). *Verified live Jun 2026.*
2. https://livekit.com/blog/tutorial-using-webrtc-react-webaudio-to-create-spatial-audio/ — official:
   `mediaStreamTrack → createMediaStreamSource → PannerNode`, relative position, exponential distanceModel.
3. https://docs.livekit.io/home/client/tracks/subscribe/ — per-participant `setVolume(0..1)`;
   `autoSubscribe:false` + `setSubscribed`/`setEnabled` selective subscription for bandwidth.
4. https://support.gather.town/hc/en-us/articles/15909782743444-Overview-of-Spatial-Audio-Video — Gather
   is distance-attenuated gain, NOT truly spatialized (so proximity-volume is the pragmatic target).
5. https://www.forasoft.com/learn/video-streaming/articles-streaming/sfu-comparison-mediasoup-janus-livekit-jitsi-pion
   — self-host pays off ~500+ CCU; mediasoup 3–5mo to production; LiveKit Cloud↔self-host without rewrite.
6. https://docs.slack.dev/apis/web-api/user-presence-and-status/ — `users.profile.set` sets custom status
   (user token); `setPresence` only auto/away; `status_expiration` auto-clears.
7. https://api.slack.com/methods/chat.postMessage — bot token + Block Kit; full channel/threading/edit control.
8. https://docs.slack.dev/app-management/distribution/ — single-workspace internal apps install without review.
9. https://devblogs.microsoft.com/microsoft365dev/retirement-of-office-365-connectors-within-microsoft-teams/
   — connectors disabled **May 18–22 2026**; migrate to Power Automate Workflows; MessageCards lack interactive
   buttons. *Re-verified Jun 2026.*
10. https://developers.google.com/workspace/calendar/api/guides/event-types — Google `eventType`:
    default/focusTime/outOfOffice/workingLocation.
11. https://workspaceupdates.googleblog.com/2023/11/calendar-api-read-write-out-of-office-and-focus-time-events.html
    — focusTime/OOO readable with full properties under the existing `calendar.events.readonly` scope (since Nov 2023).
12. https://learn.microsoft.com/en-us/graph/api/user-list-calendarview?view=graph-rest-1.0 — Graph
    `/me/calendarView` auto-expands recurring events; scope `Calendars.ReadBasic`. *Doc updated 2026-05-19.*
13. https://learn.microsoft.com/en-us/graph/api/channel-post-messages?view=graph-rest-1.0 — Graph channel
    `chatMessage` post (`ChannelMessage.Send`); Adaptive Cards for buttons.
14. https://learn.microsoft.com/en-us/graph/api/presence-setuserpreferredpresence?view=graph-rest-1.0 —
    `setUserPreferredPresence` (`Presence.ReadWrite`, delegated); ISO-8601 expiry; live-session requirement.
    *Doc updated 2025-09-25.*
15. https://github.com/excalidraw/excalidraw — Excalidraw v0.18.1 (2026-04, **MIT**); React peer dep;
    multiplayer via separate sync server (or our Colyseus JSON deltas). tldraw rejected ($6k/yr). *Re-verified Jun 2026.*
16. https://github.com/node-saml/passport-saml — `@node-saml/node-saml` v5.1.0 (2025-07); no passport needed.
17. https://securityboulevard.com/2026/06/how-to-add-enterprise-sso-to-a-multi-tenant-saas-application/ —
    connection-per-org + email-domain→tenant routing + JIT provision.
18. https://hashorn.com/blog/enterprise-ready-saas-sso-scim-audit-logs — readiness order RBAC→audit→SSO→SCIM; SOC 2 gating.
19. https://github.com/scimmyjs/scimmy — SCIMMY v1.3.5 (2025-03) + routers; RFC-7644 PATCH/filter/schema.
20. https://github.com/plausible/analytics — cookieless, no PII/IP stored, AGPL self-hostable; structurally cannot surveil.
21. https://posthog.com/pricing — powerful but autocapture/replay/person-profiles conflict with constitution; lock down or avoid.
22. https://docs.sentry.io/security-legal-pii/ — error tracking; `sendDefaultPii:false`, Session Replay must stay OFF.
23. https://docs.colyseus.io/deployment/scalability — horizontal scale needs RedisDriver + RedisPresence;
    one room lives on one process → shard the office. *Re-verified Jun 2026.*
24. https://www.npmjs.com/package/@colyseus/redis-driver — RedisDriver stores room listings in Redis (ioredis),
    supports Redis Cluster.
25. https://www.kumospace.com/help/spatial-and-room-audio — Kumospace proximity/room audio + knock-to-enter private zones (competitive baseline).
26. https://developers.zoom.us/blog/transition-to-obf-token-meetingsdk-apps/ — from Mar 2 2026 external-meeting
    join needs ZAK/OBF tokens or RTMS; use link-out only, skip embedded SDK.
