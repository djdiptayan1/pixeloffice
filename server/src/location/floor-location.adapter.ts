// ---------------------------------------------------------------------------
// Floor-location adapter — OPT-IN physical-floor detection from the client IP.
//
// Each office floor sits on a different WiFi/subnet. When a user EXPLICITLY
// enables "Sync my floor to where I'm sitting" (off by default), the server maps
// their current IP to:
//   - an Office/Remote classification, and
//   - (when Office) a specific floor id, via the existing floor-change machinery.
//
// This is sensitive (physical-location data), so the whole feature is built to
// be constitution-safe (plan.md "presence, not surveillance"):
//   * It is framework-free and lives behind the FloorLocationAdapter interface
//     (no Colyseus/Express here — the room is the only seam that calls it).
//   * It is OFF unless the operator configures OFFICE_SUBNETS / OFFICE_CIDRS. No
//     env => NoopFloorLocationAdapter => everyone REMOTE/null, feature inert.
//   * PRIVACY — HARD RULE: this module NEVER logs the IP, NEVER persists it, and
//     NEVER stores a location history / movement trace / who-was-on-which-floor-
//     when. The IP is a TRANSIENT argument to a pure classify()/detectFloorId()
//     call; nothing about it is retained beyond the return value. The caller
//     stores only the resulting Office/Remote tag + current floor.
// ---------------------------------------------------------------------------

/**
 * Maps a client IP (already resolved by the caller honoring the trust-proxy
 * decision) to an Office/Remote tag and an optional floor id. Implementations
 * are pure: same input => same output, no I/O, no clock, no logging, no state
 * keyed on the IP.
 */
export interface FloorLocationAdapter {
  /**
   * "OFFICE" if `ip` is inside ANY configured office range (a subnet rule OR an
   * office CIDR), else "REMOTE". Undefined/garbage IP => "REMOTE".
   */
  classify(ip: string | undefined): "OFFICE" | "REMOTE";
  /**
   * The floor id of the FIRST matching subnet rule, or null when the IP matches
   * no floor-specific subnet (including: matched only a floor-less OFFICE_CIDR,
   * classified REMOTE, or the IP is undefined/garbage).
   */
  detectFloorId(ip: string | undefined): string | null;
  /** True only when at least one rule parsed (the feature is actually active). */
  enabled(): boolean;
}

/**
 * Resolve the real client IP from a raw HTTP upgrade request, honoring the same
 * trust-proxy decision the REST rate limiter uses.
 *
 * SECURITY / PRIVACY: X-Forwarded-For is attacker-controlled and is only honored
 * when `trustProxy` is true (the server sits behind a vetted reverse proxy). In
 * that case the FIRST hop (the original client) is taken. When not trusted we use
 * the raw socket peer address. The returned value is transient — the caller
 * classifies it and DISCARDS it; it is never logged or persisted.
 *
 * `headers` is the request's header bag; `remoteAddress` is the socket peer.
 */
export function clientIpFromRequest(
  headers: Record<string, string | string[] | undefined> | undefined,
  remoteAddress: string | undefined,
  trustProxy: boolean,
): string | undefined {
  if (trustProxy && headers) {
    const xff = headers["x-forwarded-for"];
    const raw = Array.isArray(xff) ? xff[0] : xff;
    if (typeof raw === "string" && raw.trim().length > 0) {
      // The first hop is the original client (normalizeIpv4 also splits commas).
      return raw.split(",")[0]!.trim();
    }
  }
  return remoteAddress;
}

/** One parsed CIDR rule: a base address (as uint32), a prefix mask, and an
 *  optional floor id. Floor-less rules (OFFICE_CIDRS) carry floorId === null. */
interface CidrRule {
  base: number; // network address, masked, as an unsigned 32-bit int
  mask: number; // the prefix bitmask as an unsigned 32-bit int
  floorId: string | null;
}

/**
 * Normalize an inbound IP string to a plain dotted-quad IPv4, or null.
 *
 * Tolerates:
 *   - IPv6-mapped IPv4 ("::ffff:10.1.2.3" and "::ffff:0a01:0203" rare hex form
 *     is NOT handled — only the common dotted tail) -> "10.1.2.3".
 *   - an X-Forwarded-For style comma list -> the FIRST hop (the original client).
 *   - surrounding whitespace and a bracketed/explicit port suffix on IPv4.
 *
 * Returns null for undefined, empty, pure-IPv6, or otherwise unparseable input
 * (the caller treats null as REMOTE/no-floor). NEVER logs the value.
 */
export function normalizeIpv4(ip: string | undefined): string | null {
  if (typeof ip !== "string") return null;
  let s = ip.trim();
  if (s.length === 0) return null;

  // X-Forwarded-For may be a comma-separated chain; the first hop is the client.
  if (s.includes(",")) {
    s = s.split(",")[0]!.trim();
    if (s.length === 0) return null;
  }

  // IPv6-mapped IPv4: "::ffff:10.1.2.3" (case-insensitive prefix).
  const mappedIdx = s.toLowerCase().lastIndexOf("::ffff:");
  if (mappedIdx !== -1) {
    s = s.slice(mappedIdx + "::ffff:".length);
  }

  // Strip a trailing ":port" ONLY for a dotted-quad (IPv6 uses colons too, but
  // we only support IPv4 matching, so anything still colon-bearing after the
  // mapped-prefix strip and that is not a dotted quad is rejected below).
  const colonIdx = s.indexOf(":");
  if (colonIdx !== -1) {
    const head = s.slice(0, colonIdx);
    // Only treat as host:port when the head looks like a dotted quad.
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(head)) {
      s = head;
    }
  }

  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const octets = [m[1], m[2], m[3], m[4]].map((o) => Number(o));
  if (octets.some((o) => o < 0 || o > 255)) return null;
  return octets.join(".");
}

/** Pack a validated dotted-quad into an unsigned 32-bit int. */
function ipToUint32(dotted: string): number {
  const [a, b, c, d] = dotted.split(".").map((o) => Number(o));
  // >>> 0 keeps the result unsigned (left-shift can produce a negative int32).
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

/**
 * Parse a single "CIDR" or "CIDR=floorId" token into a CidrRule, or null when
 * malformed (bad address, bad/absent prefix, prefix out of 0..32). Garbage rules
 * are dropped silently — a misconfigured pair must never crash boot.
 */
export function parseCidrRule(token: string, floorId: string | null): CidrRule | null {
  const t = token.trim();
  if (t.length === 0) return null;
  const slash = t.indexOf("/");
  if (slash === -1) return null; // require an explicit prefix (e.g. /16, /32)
  const addr = normalizeIpv4(t.slice(0, slash));
  if (!addr) return null;
  const prefix = Number(t.slice(slash + 1).trim());
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  // Build the mask. A /0 means "match everything" (mask 0); avoid the JS
  // left-shift-by-32 quirk (32-bit shift counts are taken mod 32).
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const base = (ipToUint32(addr) & mask) >>> 0;
  return { base, mask, floorId };
}

/** True if a normalized IPv4 falls inside a parsed rule. */
function ruleMatches(rule: CidrRule, ipInt: number): boolean {
  return ((ipInt & rule.mask) >>> 0) === rule.base;
}

/**
 * Env-driven adapter.
 *
 * OFFICE_SUBNETS = comma-separated "CIDR=floorId" pairs mapping a subnet to a
 *   floor, e.g. "10.1.0.0/16=floor-1,10.2.0.0/16=floor-2,10.0.0.0/16=ground".
 * OFFICE_CIDRS  = optional comma-separated extra office ranges with NO specific
 *   floor (still classify OFFICE, but detectFloorId returns null), e.g.
 *   "203.0.113.0/24,198.51.100.0/24".
 *
 * classify() => OFFICE if the IP matches ANY rule (subnet or office cidr).
 * detectFloorId() => the floor of the first matching SUBNET rule, else null.
 * Rules are evaluated in declaration order; subnet rules are checked before the
 * floor-less office cidrs for floor detection.
 */
export class EnvFloorLocationAdapter implements FloorLocationAdapter {
  /** Floor-bearing subnet rules, in declaration order (first match wins). */
  private readonly subnetRules: CidrRule[];
  /** Floor-less office ranges (classify OFFICE, no floor). */
  private readonly officeRules: CidrRule[];

  constructor(officeSubnets: string | undefined, officeCidrs: string | undefined) {
    this.subnetRules = (officeSubnets ?? "")
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const eq = pair.indexOf("=");
        if (eq === -1) return null; // a subnet pair MUST name a floor
        const cidr = pair.slice(0, eq);
        const floorId = pair.slice(eq + 1).trim();
        if (floorId.length === 0) return null;
        return parseCidrRule(cidr, floorId);
      })
      .filter((r): r is CidrRule => r !== null);

    this.officeRules = (officeCidrs ?? "")
      .split(",")
      .map((cidr) => cidr.trim())
      .filter(Boolean)
      .map((cidr) => parseCidrRule(cidr, null))
      .filter((r): r is CidrRule => r !== null);
  }

  classify(ip: string | undefined): "OFFICE" | "REMOTE" {
    const dotted = normalizeIpv4(ip);
    if (!dotted) return "REMOTE";
    const ipInt = ipToUint32(dotted);
    for (const rule of this.subnetRules) {
      if (ruleMatches(rule, ipInt)) return "OFFICE";
    }
    for (const rule of this.officeRules) {
      if (ruleMatches(rule, ipInt)) return "OFFICE";
    }
    return "REMOTE";
  }

  detectFloorId(ip: string | undefined): string | null {
    const dotted = normalizeIpv4(ip);
    if (!dotted) return null;
    const ipInt = ipToUint32(dotted);
    for (const rule of this.subnetRules) {
      if (ruleMatches(rule, ipInt)) return rule.floorId; // floorId is non-null for subnet rules
    }
    return null; // matched only an office cidr (or nothing) => no specific floor
  }

  enabled(): boolean {
    return this.subnetRules.length > 0 || this.officeRules.length > 0;
  }
}

/**
 * Inert adapter used when no office ranges are configured (the zero-config
 * default). Everyone is REMOTE / no floor, and enabled() is false so the room
 * can treat the whole feature as off. The toggle still works for the user — it
 * simply always resolves to REMOTE.
 */
export class NoopFloorLocationAdapter implements FloorLocationAdapter {
  classify(): "OFFICE" | "REMOTE" {
    return "REMOTE";
  }
  detectFloorId(): string | null {
    return null;
  }
  enabled(): boolean {
    return false;
  }
}

/**
 * Build the adapter from env: the Env impl when OFFICE_SUBNETS or OFFICE_CIDRS is
 * set AND at least one rule parses; otherwise the Noop (feature off). Never
 * throws — a misconfigured env degrades to fewer/zero rules, never a crash.
 */
export function createFloorLocationAdapter(
  env: NodeJS.ProcessEnv = process.env,
): FloorLocationAdapter {
  const subnets = env.OFFICE_SUBNETS?.trim();
  const cidrs = env.OFFICE_CIDRS?.trim();
  if (!subnets && !cidrs) return new NoopFloorLocationAdapter();
  const adapter = new EnvFloorLocationAdapter(subnets, cidrs);
  // If everything was garbage and nothing parsed, fall back to Noop so enabled()
  // semantics stay clean (configured-but-empty behaves like unconfigured).
  return adapter.enabled() ? adapter : new NoopFloorLocationAdapter();
}
