// ---------------------------------------------------------------------------
// Minimal leveled logger. A real deployment can swap this for pino/winston —
// the call sites only use this tiny surface.
//
// Privacy note (plan: presence, not surveillance): operational events only.
// We log joins/leaves, social events, meetings, admin actions, and integration
// failures. We NEVER log chat contents, movement, or per-user activity beyond
// what the presence product itself shows to every coworker.
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function configuredLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return raw in LEVEL_ORDER ? (raw as LogLevel) : "info";
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(namespace: string): Logger;
}

function format(level: LogLevel, ns: string, msg: string, fields?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const extra =
    fields && Object.keys(fields).length > 0
      ? " " +
        Object.entries(fields)
          .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
          .join(" ")
      : "";
  return `${ts} ${level.toUpperCase().padEnd(5)} [${ns}] ${msg}${extra}`;
}

export function createLogger(namespace: string): Logger {
  const min = LEVEL_ORDER[configuredLevel()];
  const emit = (level: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (LEVEL_ORDER[level] < min) return;
    const line = format(level, namespace, msg, fields);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (ns) => createLogger(`${namespace}:${ns}`),
  };
}
