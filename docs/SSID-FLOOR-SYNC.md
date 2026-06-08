# SSID -> Floor Sync (companion floor reports)

How a per-machine **companion helper** reports the WiFi SSID so the server can
place an **opted-in** user on the right physical floor.

## Why this exists

Browsers cannot read the WiFi SSID, and a typical office is one flat `/16`
subnet, so the IP-based floor detection (`OFFICE_SUBNETS`) cannot tell floors
apart when they share a subnet. A small companion helper on each machine reads
the SSID via the OS and POSTs it to the server, which maps `SSID -> floor` and
applies it to the user sitting at that machine.

## Constitution (non-negotiable)

- **Opt-in only.** A report is **applied** only to a user who has enabled
  "Sync my floor to where I'm sitting" in Settings (the existing
  `SET_LOCATION_SYNC` toggle). A report for a user who has not opted in returns
  `matched: 0` and changes nothing — no move, no tag.
- **Presence, not surveillance.** The server **never logs or persists the SSID
  or the IP**, and keeps **no** location history. It stores only the current
  `place` (`OFFICE`) + current floor.
- **Human agency.** A report may move the avatar **only because the user opted
  in** — that consent is the action. Opting out clears the tag and never moves.

## Endpoint

```
POST /api/location/floor-report
Content-Type: application/json

{ "ssid": "Hustle@KALVIUM2F5G", "secret": "<optional>" }
```

Response (always `200` unless the secret is required and wrong, or the body is
malformed):

```jsonc
{ "floorId": "floor-2", "matched": 1 }   // resolved + applied to 1 opted-in session
{ "floorId": null,      "matched": 0 }   // SSID matched no rule — benign no-op
```

- `floorId` — the resolved floor id, or `null` when the SSID matched no rule.
- `matched` — how many of the **caller's own** live sessions were updated. `0`
  is normal and fine: the user simply has not enabled floor sync (or no browser
  session is open on that machine right now).

Status codes:

- `200` — resolved (whether or not anything was applied; `matched` tells you).
- `400` — missing/empty `ssid`.
- `401` — `FLOOR_SYNC_SECRET` is configured and `body.secret` is missing/wrong.

### IP-matching model

The companion and the browser run on the **same machine**, so they share a LAN
IP. The server matches the report against the client IP it captured for each
connected session (the same `X-Forwarded-For`/socket logic the rest of the app
uses, honoring `TRUST_PROXY`) and applies the resolved floor to that machine's
opted-in sessions. You can only ever affect your **own** machine's sessions, so
a self-reported floor has no abuse surface — which is why the shared secret is
optional.

If the resolved floor differs from the user's current floor, the server performs
the **same consented floor change** the elevator uses (free landing tile,
`PLAYER_LEFT`/`PLAYER_JOINED` to the two floors, `FLOOR_CHANGED` to the mover)
and broadcasts `S2C.LOCATION` (floor-scoped). If it's the same floor, the user
is just tagged `OFFICE`.

## Companion contract (what to build)

1. Read the current WiFi SSID from the OS:
   - macOS: `networksetup -getairportnetwork <iface>` or the CoreWLAN API.
   - Windows: `netsh wlan show interfaces`.
   - Linux: `nmcli -t -f active,ssid dev wifi`.
2. POST it to `http://<server>:2567/api/location/floor-report` on a small
   interval (e.g. every 30-60 s) and on SSID change. Include `secret` if the
   operator set `FLOOR_SYNC_SECRET`.
3. Do **not** store the SSID anywhere; just report the current value. The server
   is the same — it never logs/persists it.

The client/browser does nothing new for this feature: the user's existing
in-app **floor-sync toggle** is what gates whether a report is applied.

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `SSID_FLOOR_MAP` | `KALVIUMGF=ground,KALVIUM1F=floor-1,KALVIUM2F=floor-2` | Comma-separated `substring=floorId` rules. **Case-insensitive substring** match, evaluated in order, **first match wins**. `floorId` must exist in the active building. |
| `FLOOR_SYNC_SECRET` | _(unset)_ | Optional shared secret the companion must send as `body.secret`. Unset = endpoint accepts the report (self-report has no abuse surface). |

Because `SSID_FLOOR_MAP` defaults to the KALVIUM map, SSID sync is effectively
**always available** — but a report still only **applies** to opted-in users, so
a zero-config or fully-remote deploy is unaffected.

Substring matching tolerates band suffixes and prefixes: `KALVIUM2F`,
`Hustle@KALVIUM2F5G`, and `Hustle@KALVIUM2F2.4G` all resolve to `floor-2`.

## Privacy summary

The SSID is resolved to a floor id and **discarded**; the IP is matched and
**discarded**. Nothing about either is logged, persisted, or kept as history.
The only state retained is the current `place`/floor on the live session, which
the user clears at will by turning floor sync off.
