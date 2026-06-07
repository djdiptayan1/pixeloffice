// Loads a repo-root `.env` into process.env. Imported first in index.ts so the
// container sees the vars at module-load time. Uses Node's built-in loader
// (no dependency), does not override existing env vars, and no-ops if absent.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const candidates = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "..", ".env"),
];

// Load the first .env that exists (server cwd, then repo root).
for (const path of candidates) {
  if (!existsSync(path)) continue;
  try {
    (process as NodeJS.Process & { loadEnvFile?: (p: string) => void }).loadEnvFile?.(path);
  } catch {
    /* malformed/unreadable — ignore */
  }
  break;
}
