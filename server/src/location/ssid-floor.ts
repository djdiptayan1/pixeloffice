// ---------------------------------------------------------------------------
// SSID -> floor resolver — OPT-IN physical-floor detection from the WiFi SSID.
//
// WHY THIS EXISTS: browsers cannot read the WiFi SSID, and a typical office is
// one flat /16 subnet, so the IP-based FloorLocationAdapter cannot separate
// floors that share a subnet. A tiny COMPANION helper on each machine reads the
// SSID via the OS and POSTs it to /api/location/floor-report; this module maps
// the reported SSID to a floor id, which the room applies to the opted-in user.
//
// CONSTITUTION-SAFE (AGENTS.md "presence, not surveillance"):
//   * Framework-free + pure: same input => same output. No I/O, no clock, no
//     state. The room is the only Colyseus seam; the route is the only HTTP seam.
//   * PRIVACY — HARD RULE: this module NEVER logs or persists the SSID. The SSID
//     is a TRANSIENT argument to a pure ssidToFloorId() call; nothing about it
//     is retained beyond the returned floor id. No location history is kept.
//   * OPT-IN: resolving an SSID to a floor here is a no-op for presence. A floor
//     report only APPLIES to a user who has explicitly enabled floor sync in-app
//     (the existing SET_LOCATION_SYNC toggle gates whether a report is applied).
//
// CONFIG: SSID_FLOOR_MAP = comma-separated "substring=floorId" rules. The match
// is a CASE-INSENSITIVE SUBSTRING test (so band suffixes like "@5G"/"2.4G" and
// "Hustle@KALVIUM2F" all resolve), evaluated in declaration order — FIRST match
// wins. The default (when unset) is the KALVIUM office mapping, so SSID sync is
// effectively ALWAYS AVAILABLE — but, again, a report only applies to opted-in
// users, so an unconfigured/zero-config deploy is unaffected.
// ---------------------------------------------------------------------------

/** The built-in default mapping for the KALVIUM office (case-insensitive). */
export const DEFAULT_SSID_FLOOR_MAP =
  "KALVIUMGF=ground,KALVIUM1F=floor-1,KALVIUM2F=floor-2";

/** One parsed SSID rule: a lowercased substring to look for, and its floor id. */
export interface SsidRule {
  /** The substring to match against the SSID, ALREADY lowercased. */
  needle: string;
  /** The floor id this rule resolves to (verbatim from config). */
  floorId: string;
}

/**
 * Parse SSID_FLOOR_MAP (or the default) into ordered rules. Garbage rules (no
 * "=", empty substring, or empty floor id) are dropped silently so a misconfig
 * never crashes boot. The needle is lowercased once here for case-insensitive
 * substring matching. Order is preserved (first match wins downstream).
 */
export function parseSsidFloorMap(raw: string | undefined): SsidRule[] {
  const src = raw && raw.trim().length > 0 ? raw : DEFAULT_SSID_FLOOR_MAP;
  return src
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair): SsidRule | null => {
      const eq = pair.indexOf("=");
      if (eq === -1) return null;
      const needle = pair.slice(0, eq).trim().toLowerCase();
      const floorId = pair.slice(eq + 1).trim();
      if (needle.length === 0 || floorId.length === 0) return null;
      return { needle, floorId };
    })
    .filter((r): r is SsidRule => r !== null);
}

/**
 * The SSID -> floor resolver interface. Pure: classify an SSID to a floor id (or
 * null when nothing matches). `validFloorIds`, when provided, restricts results
 * to floor ids that actually exist in the active building (an unknown floor id
 * resolves to null, never to a phantom floor).
 */
export interface SsidFloorResolver {
  /** The resolved floor id for `ssid`, or null when no rule matches / it is invalid. */
  ssidToFloorId(ssid: string | undefined): string | null;
  /** True when at least one rule parsed (always true given the default). */
  enabled(): boolean;
  /** How many rules parsed (for the {matched} count semantics + tests). */
  ruleCount(): number;
}

/**
 * Env/config-driven SSID resolver. Built from SSID_FLOOR_MAP (default applied
 * when unset). When `validFloorIds` is supplied (the active building's floor
 * ids), a rule that names a floor NOT in the building is dropped so a report can
 * never target a phantom floor.
 */
export class DefaultSsidFloorResolver implements SsidFloorResolver {
  private readonly rules: SsidRule[];

  constructor(raw: string | undefined, validFloorIds?: Iterable<string>) {
    const parsed = parseSsidFloorMap(raw);
    if (validFloorIds) {
      const valid = new Set(validFloorIds);
      this.rules = parsed.filter((r) => valid.has(r.floorId));
    } else {
      this.rules = parsed;
    }
  }

  ssidToFloorId(ssid: string | undefined): string | null {
    if (typeof ssid !== "string") return null;
    const hay = ssid.trim().toLowerCase();
    if (hay.length === 0) return null;
    for (const rule of this.rules) {
      if (hay.includes(rule.needle)) return rule.floorId;
    }
    return null;
  }

  enabled(): boolean {
    return this.rules.length > 0;
  }

  ruleCount(): number {
    return this.rules.length;
  }
}

/**
 * Build the resolver from env. `validFloorIds` are the active building's floor
 * ids (passed by the container) so rules naming a missing floor are pruned. The
 * default map is always applied when SSID_FLOOR_MAP is unset, so SSID sync is
 * effectively always available — but a report only APPLIES to opted-in users.
 */
export function createSsidFloorResolver(
  env: NodeJS.ProcessEnv = process.env,
  validFloorIds?: Iterable<string>,
): SsidFloorResolver {
  return new DefaultSsidFloorResolver(env.SSID_FLOOR_MAP, validFloorIds);
}
