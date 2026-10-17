import { describe, expect, test } from "bun:test";
import {
  buildKind,
  headersFile,
  previewLabel,
  siteOrigin,
} from "./build-context";

describe("buildKind", () => {
  test("local and GitHub Actions builds are production", () => {
    expect(buildKind({})).toBe("production");
    expect(buildKind({ CI: "true", GITHUB_ACTIONS: "true" })).toBe(
      "production",
    );
  });

  test("a Workers Builds build of master is production", () => {
    expect(buildKind({ WORKERS_CI: "1", WORKERS_CI_BRANCH: "master" })).toBe(
      "production",
    );
  });

  test("a Workers Builds build of any other branch is a preview", () => {
    expect(buildKind({ WORKERS_CI: "1", WORKERS_CI_BRANCH: "dev" })).toBe(
      "preview",
    );
    expect(
      buildKind({ WORKERS_CI: "1", WORKERS_CI_BRANCH: "feature/photos" }),
    ).toBe("preview");
  });

  test("refuses to guess when Workers Builds gives no branch", () => {
    expect(() => buildKind({ WORKERS_CI: "1" })).toThrow(/WORKERS_CI_BRANCH/);
  });
});

describe("siteOrigin", () => {
  test("production builds use the real domain", () => {
    expect(siteOrigin({})).toBe("https://empyreangate.org");
    expect(siteOrigin({ WORKERS_CI: "1", WORKERS_CI_BRANCH: "master" })).toBe(
      "https://empyreangate.org",
    );
  });

  test("a preview build uses its own subdomain", () => {
    expect(siteOrigin({ WORKERS_CI: "1", WORKERS_CI_BRANCH: "dev" })).toBe(
      "https://dev.empyreangate.org",
    );
  });
});

describe("previewLabel", () => {
  test("plain names pass through", () => {
    expect(previewLabel("dev")).toBe("dev");
  });

  test("mirrors Wrangler's sanitiser for anything else", () => {
    expect(previewLabel("Feature/New_Photos")).toBe("feature-new-photos");
    expect(previewLabel("--a//b--")).toBe("a-b");
  });

  test("refuses labels DNS can't hold", () => {
    expect(() => previewLabel("///")).toThrow(/no usable hostname label/);
    expect(() => previewLabel("x".repeat(64))).toThrow(/DNS allows 63/);
  });
});

describe("headersFile", () => {
  test("every build gets the safety headers, in one block for every path", () => {
    for (const kind of ["production", "preview"] as const) {
      const file = headersFile(kind);
      expect(file.split("\n")[0]).toBe("/*");
      expect(file.match(/^\S/gm)).toEqual(["/"]);
      expect(file).toContain("X-Content-Type-Options: nosniff");
      expect(file).toContain("Content-Security-Policy: frame-ancestors 'none'");
    }
  });

  test("only a preview says noindex", () => {
    expect(headersFile("production")).not.toContain("noindex");
    expect(headersFile("preview")).toContain("X-Robots-Tag: noindex");
  });
});
