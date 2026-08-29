import type { PublicRoute } from "./public-routes";

const YEAR = new Date().getFullYear();
const SUPPORT_EMAIL = "support@pixeloffice.app";
const LOGO = "/logo.png";
const HERO = "/image.png";
const GOLDEN_HOUR = "/pixel-office-golden-hour-og.png";
const WORKPLACE_MAP = "/pixel-office-workplace-map-og.png";
const OFFICE_OG = "/pixel-office-og.png";
const DEFAULT_SITE_ORIGIN = "https://pixeloffice.app";
const DESCRIPTION =
  "A multiplayer virtual office for presence, meetings, and social interaction without surveillance.";

export function landingAssetPaths(): string[] {
  return [LOGO, HERO, GOLDEN_HOUR, WORKPLACE_MAP, OFFICE_OG];
}

export interface PublicSeo {
  title: string;
  description: string;
  canonical: string;
  ogImage: string;
}

function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return DEFAULT_SITE_ORIGIN;
  }
}

function routePath(route: PublicRoute): string {
  if (route === "landing") return "/";
  return `/${route}`;
}

export function publicSeoForRoute(
  route: PublicRoute,
  origin = DEFAULT_SITE_ORIGIN,
): PublicSeo {
  const base = normalizeOrigin(origin);
  const path = routePath(route);
  return {
    title:
      route === "landing"
        ? "Pixel Office"
        : route === "privacy"
          ? "Privacy Policy | Pixel Office"
          : "Terms and Conditions | Pixel Office",
    description: DESCRIPTION,
    canonical: `${base}${path}`,
    ogImage: `${base}${route === "landing" ? GOLDEN_HOUR : OFFICE_OG}`,
  };
}

function pixelMark(): string {
  return `
    <span class="public-mark" aria-hidden="true">
      <img src="${LOGO}" alt="" />
    </span>
  `;
}

function nav(active?: PublicRoute): string {
  return `
    <header class="public-nav">
      <a class="public-brand" href="/" aria-label="Pixel Office home">
        ${pixelMark()}
        <span>Pixel Office</span>
      </a>
      <nav class="public-links" aria-label="Public navigation">
        <a ${active === "privacy" ? 'aria-current="page"' : ""} href="/privacy">Privacy</a>
        <a ${active === "terms" ? 'aria-current="page"' : ""} href="/terms">Terms</a>
        <a class="public-nav-cta" href="/app">Enter office</a>
      </nav>
    </header>
  `;
}

function footer(): string {
  return `
    <footer class="public-footer">
      <span>&copy; ${YEAR} Pixel Office</span>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="/app">Enter office</a>
    </footer>
  `;
}

function landing(): string {
  return `
    ${nav()}
    <main class="public-main">
      <section class="public-hero">
        <div class="public-hero-copy">
          <h1>Pixel Office</h1>
          <p>
            A multiplayer virtual office where presence, meetings, and hallway moments
            feel alive without turning work into surveillance.
          </p>
          <div class="public-actions">
            <a class="public-primary" href="/app">Enter office</a>
          </div>
          <div class="public-signal-row" aria-label="Presence signals">
            <span><b></b>Available</span>
            <span><b></b>In meeting</span>
            <span><b></b>Focus</span>
          </div>
        </div>
        <div class="public-hero-stage" aria-label="Pixel Office product preview">
          <div class="stage-orbit orbit-a">Focus</div>
          <div class="stage-orbit orbit-b">Join</div>
          <div class="stage-orbit orbit-c">Coffee</div>
          <figure class="public-product-frame">
            <img src="${HERO}" alt="Pixel Office virtual workspace with teammates, meeting rooms, desks, lounge games, and social areas" />
          </figure>
          <div class="stage-card stage-card-top">
            <span>Now</span>
            <strong>Design sync in Room A</strong>
          </div>
          <div class="stage-card stage-card-bottom">
            <span>Agency</span>
            <strong>Every move is user-clicked</strong>
          </div>
        </div>
      </section>

      <section class="public-feature-rail" aria-label="Product pillars">
        <article class="feature-card feature-card-tall">
          <span class="feature-index">01</span>
          <h2>Presence that explains itself</h2>
          <p>Status comes from explicit choices, calendar meetings, and session activity. The UI shows why someone is available, focused, away, or in a meeting.</p>
        </article>
        <article class="feature-card">
          <span class="feature-index">02</span>
          <h2>Meetings stay human</h2>
          <p>Calendar events surface a Join action. Pixel Office never auto-moves an avatar or redirects someone without a click.</p>
        </article>
        <article class="feature-card">
          <span class="feature-index">03</span>
          <h2>Integrations are optional</h2>
          <p>Google Calendar, Microsoft, greytHR, Postgres, and Redis sit behind adapters. If they are not configured, the office still runs.</p>
        </article>
      </section>

      <section class="public-showcase public-showcase-dark">
        <figure>
          <img src="${WORKPLACE_MAP}" alt="Pixel Office meeting room with a visible Join action" />
        </figure>
        <div>
          <h2>Meetings appear. People decide.</h2>
          <p>
            Google Calendar can light up the right meeting room and show a Meet link,
            but only a user's explicit Join click seats their avatar.
          </p>
          <a class="public-secondary" href="/app">Try the office flow</a>
        </div>
      </section>

      <section class="public-motion-band" aria-label="Office atmosphere">
        <img src="${GOLDEN_HOUR}" alt="A warm pixel-art office full of presence, meetings, and lounge interactions" />
        <div class="motion-copy">
          <h2>Designed to feel occupied, not observed.</h2>
          <p>Ambient spaces, lounge games, profile cards, proximity calls, and floor-aware rooms make the office feel alive while keeping surveillance out of the product.</p>
        </div>
      </section>

      <section class="public-privacy-split">
        <div>
          <h2>Presence, never surveillance</h2>
          <p>Pixel Office deliberately avoids keystroke logging, mouse tracking, screenshots, productivity scores, activity ranking, and who-was-where-when history.</p>
        </div>
        <ul aria-label="Privacy boundaries">
          <li>No screenshots</li>
          <li>No productivity scores</li>
          <li>No activity ranking</li>
          <li>No movement history</li>
        </ul>
      </section>

      <section class="public-final-cta">
        <img src="${OFFICE_OG}" alt="Pixel Office open workspace preview" />
        <div>
          <h2>Bring the office back into view.</h2>
          <p>Start with zero config locally, then connect OAuth and Calendar when your team is ready.</p>
          <a class="public-primary" href="/app">Enter office</a>
        </div>
      </section>
    </main>
    ${footer()}
  `;
}

function legalPage(route: "privacy" | "terms"): string {
  const isPrivacy = route === "privacy";
  return `
    ${nav(route)}
    <main class="public-main public-legal">
      <article class="legal-doc">
        <p class="legal-updated">Last updated: June 12, 2026</p>
        <h1>${isPrivacy ? "Privacy Policy" : "Terms and Conditions"}</h1>
        ${isPrivacy ? privacyContent() : termsContent()}
      </article>
    </main>
    ${footer()}
  `;
}

function privacyContent(): string {
  return `
    <section>
      <h2>What Pixel Office is</h2>
      <p>Pixel Office is a multiplayer virtual office for team presence, meetings, and social interaction. The map is a visualization layer, not a monitoring tool.</p>
    </section>
    <section>
      <h2>Information we use</h2>
      <p>We may use your account identity, display profile, explicit status selections, calendar meeting metadata you connect, meeting participation actions, and session connection state to run the office.</p>
    </section>
    <section>
      <h2>Google Calendar</h2>
      <p>If you connect Google Calendar, Pixel Office reads calendar event metadata needed to show current or upcoming meetings, presence, participant context, and available Meet links. You can disconnect the grant.</p>
    </section>
    <section>
      <h2>What we do not collect</h2>
      <p>Pixel Office does not collect keystrokes, mouse movement, screenshots, IDE activity, productivity scores, activity rankings, or historical who-was-where-when trails.</p>
    </section>
    <section>
      <h2>Optional integrations</h2>
      <p>Integrations such as Google Calendar, Microsoft, greytHR, Postgres, and Redis are optional and degrade gracefully when unconfigured or unavailable.</p>
    </section>
    <section>
      <h2>Contact</h2>
      <p>For privacy questions, contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
    </section>
  `;
}

function termsContent(): string {
  return `
    <section>
      <h2>Use of the service</h2>
      <p>Pixel Office is provided for team collaboration, presence, meetings, and social interaction. Use it respectfully and only with accounts you are authorized to use.</p>
    </section>
    <section>
      <h2>Human agency</h2>
      <p>Joining meetings, events, attendance actions, and floor-sync actions are explicit user actions. Do not use Pixel Office to impersonate others or automate actions on their behalf.</p>
    </section>
    <section>
      <h2>Integrations</h2>
      <p>External integrations may be enabled by your organization. Their availability is not guaranteed, and Pixel Office should continue to operate when integrations are unavailable.</p>
    </section>
    <section>
      <h2>Privacy boundaries</h2>
      <p>You may not use Pixel Office to add surveillance behavior such as keystroke logging, mouse tracking, screenshots, productivity ranking, or historical movement tracking.</p>
    </section>
    <section>
      <h2>Contact</h2>
      <p>For terms questions, contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
    </section>
  `;
}

export function renderPublicPage(route: PublicRoute, root: HTMLElement): void {
  document.body.classList.remove("office-route");
  document.body.classList.add("public-route");
  const seo = publicSeoForRoute(route, location.origin);
  document.title = seo.title;
  root.innerHTML = route === "landing" ? landing() : legalPage(route);
  if (route === "landing") enhanceLanding(root);
  setPublicMeta(seo);
}

function enhanceLanding(root: HTMLElement): void {
  const stage = root.querySelector<HTMLElement>(".public-hero-stage");
  if (!stage || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  stage.addEventListener("pointermove", (event) => {
    const rect = stage.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    stage.style.setProperty("--mx", x.toFixed(3));
    stage.style.setProperty("--my", y.toFixed(3));
  });
  stage.addEventListener("pointerleave", () => {
    stage.style.setProperty("--mx", "0");
    stage.style.setProperty("--my", "0");
  });
}

function setPublicMeta(seo: PublicSeo): void {
  upsertMeta("name", "description", seo.description);
  upsertMeta("property", "og:title", seo.title);
  upsertMeta("property", "og:description", seo.description);
  upsertMeta("property", "og:type", "website");
  upsertMeta("property", "og:url", seo.canonical);
  upsertMeta("property", "og:image", seo.ogImage);
  upsertMeta("name", "twitter:card", "summary_large_image");
  upsertMeta("name", "twitter:title", seo.title);
  upsertMeta("name", "twitter:description", seo.description);
  upsertMeta("name", "twitter:image", seo.ogImage);
  upsertCanonical(seo.canonical);
}

function upsertMeta(attr: "name" | "property", key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

function upsertCanonical(href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.rel = "canonical";
    document.head.appendChild(el);
  }
  el.href = href;
}
