import { describe, expect, it } from "vitest";
import { sslOption } from "./database";

const URL_BASE = "postgres://u:p@host:5432/db";

describe("sslOption — derive pg SSL from sslmode / env / override", () => {
  it("no sslmode and no env -> no ssl key (plain TCP for local dev)", () => {
    expect(sslOption(URL_BASE, undefined, {})).toEqual({});
  });

  it("honors an explicit override", () => {
    expect(sslOption(URL_BASE, false, {})).toEqual({ ssl: false });
    expect(sslOption(URL_BASE, { rejectUnauthorized: false }, {})).toEqual({
      ssl: { rejectUnauthorized: false },
    });
  });

  it("sslmode=require -> verifying ssl", () => {
    expect(sslOption(`${URL_BASE}?sslmode=require`, undefined, {})).toEqual({
      ssl: { rejectUnauthorized: true },
    });
  });

  it("sslmode=no-verify -> non-verifying ssl (self-signed managed CAs)", () => {
    expect(sslOption(`${URL_BASE}?sslmode=no-verify`, undefined, {})).toEqual({
      ssl: { rejectUnauthorized: false },
    });
  });

  it("sslmode=disable -> ssl false", () => {
    expect(sslOption(`${URL_BASE}?sslmode=disable`, undefined, {})).toEqual({ ssl: false });
  });

  it("falls back to DATABASE_SSL env when no sslmode in the URL", () => {
    expect(sslOption(URL_BASE, undefined, { DATABASE_SSL: "require" })).toEqual({
      ssl: { rejectUnauthorized: true },
    });
    expect(sslOption(URL_BASE, undefined, { DATABASE_SSL: "no-verify" })).toEqual({
      ssl: { rejectUnauthorized: false },
    });
    expect(sslOption(URL_BASE, undefined, { DATABASE_SSL: "false" })).toEqual({ ssl: false });
  });

  it("URL sslmode takes precedence over the env", () => {
    expect(sslOption(`${URL_BASE}?sslmode=disable`, undefined, { DATABASE_SSL: "require" })).toEqual({
      ssl: false,
    });
  });
});
