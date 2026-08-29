import { describe, expect, it } from "vitest";
import { routeForPath, appRedirectForPublicHash } from "./public-routes";
import { landingAssetPaths, publicSeoForRoute } from "./public-pages";

describe("public route split", () => {
  it("keeps the live office isolated on /app", () => {
    expect(routeForPath("/")).toBe("landing");
    expect(routeForPath("/privacy")).toBe("privacy");
    expect(routeForPath("/terms")).toBe("terms");
    expect(routeForPath("/app")).toBe("app");
    expect(routeForPath("/app/")).toBe("app");
  });

  it("preserves OAuth and calendar fragments when they land on a public route", () => {
    expect(appRedirectForPublicHash("/", "#token=abc")).toBe("/app#token=abc");
    expect(appRedirectForPublicHash("/privacy", "#error=domain_not_allowed")).toBe(
      "/app#error=domain_not_allowed",
    );
    expect(appRedirectForPublicHash("/", "#calendar=connected")).toBe(
      "/app#calendar=connected",
    );
    expect(appRedirectForPublicHash("/app", "#token=abc")).toBeNull();
    expect(appRedirectForPublicHash("/", "#section=privacy")).toBeNull();
  });

  it("selects the public brand and OG assets for the landing page", () => {
    expect(landingAssetPaths()).toEqual([
      "/logo.png",
      "/image.png",
      "/pixel-office-golden-hour-og.png",
      "/pixel-office-workplace-map-og.png",
      "/pixel-office-og.png",
    ]);
  });

  it("builds production SEO metadata with canonical app domain URLs", () => {
    expect(publicSeoForRoute("landing", "https://pixeloffice.app")).toMatchObject({
      title: "Pixel Office",
      canonical: "https://pixeloffice.app/",
      ogImage: "https://pixeloffice.app/pixel-office-golden-hour-og.png",
    });
    expect(publicSeoForRoute("terms", "https://pixeloffice.app")).toMatchObject({
      title: "Terms and Conditions | Pixel Office",
      canonical: "https://pixeloffice.app/terms",
      ogImage: "https://pixeloffice.app/pixel-office-og.png",
    });
  });

  it("keeps localhost SEO URLs local for development checks", () => {
    expect(publicSeoForRoute("privacy", "http://localhost:5173")).toMatchObject({
      canonical: "http://localhost:5173/privacy",
      ogImage: "http://localhost:5173/pixel-office-og.png",
    });
  });
});
