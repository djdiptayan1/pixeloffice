export type PublicRoute = "landing" | "privacy" | "terms";
export type AppRoute = "app";
export type ClientRoute = PublicRoute | AppRoute;

const PUBLIC_HASH_KEYS = new Set(["token", "error", "calendar"]);

export function routeForPath(pathname: string): ClientRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/app") return "app";
  if (path === "/privacy") return "privacy";
  if (path === "/terms") return "terms";
  return "landing";
}

export function appRedirectForPublicHash(pathname: string, hash: string): string | null {
  if (routeForPath(pathname) === "app") return null;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  for (const key of PUBLIC_HASH_KEYS) {
    if (params.has(key)) return `/app#${raw}`;
  }
  return null;
}
