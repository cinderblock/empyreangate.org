import { describe, expect, test } from "bun:test";
import { firstStackUrl, isFailureCode, ownScript } from "./failure-codes";

const origin = "https://empyreangate.org";

describe("isFailureCode", () => {
  test("knows its own codes and nothing inherited", () => {
    expect(isFailureCode("uncaught")).toBe(true);
    expect(isFailureCode("made-up")).toBe(false);
    expect(isFailureCode("toString")).toBe(false);
  });
});

describe("ownScript", () => {
  test("names the site's own chunks, without their hash", () => {
    expect(ownScript(`${origin}/assets/Playground-DFIzTqMR.js`, origin)).toBe(
      "Playground",
    );
    expect(ownScript(`${origin}/assets/react-dom-4JcmcyCB.js`, origin)).toBe(
      "react-dom",
    );
    expect(ownScript(`${origin}/assets/home-B94k2ibo.js?v=1`, origin)).toBe(
      "home",
    );
  });

  test("ignores everything that isn't ours", () => {
    for (const url of [
      "https://challenges.cloudflare.com/turnstile/v0/api.js",
      "https://static.cloudflareinsights.com/beacon.min.js",
      "chrome-extension://abcdef/content.js",
      `${origin}/playground/`,
      `${origin}/assets/patch_bg-GBOTfpIc.wasm`,
      `https://evil.example/assets/home-B94k2ibo.js`,
    ]) {
      expect(ownScript(url, origin)).toBeNull();
    }
  });
});

describe("firstStackUrl", () => {
  test("reads V8 and Firefox/Safari stacks", () => {
    expect(
      firstStackUrl(
        `TypeError: x is undefined\n    at run (${origin}/assets/home-B94k2ibo.js:1:234)\n    at ${origin}/assets/root-B6K4NtR_.js:2:1`,
      ),
    ).toBe(`${origin}/assets/home-B94k2ibo.js`);
    expect(
      firstStackUrl(`run@${origin}/assets/Playground-DFIzTqMR.js:3:14\n`),
    ).toBe(`${origin}/assets/Playground-DFIzTqMR.js`);
  });

  test("an extension's frame on top is what's found", () => {
    const top = firstStackUrl(
      `Error\n    at f (chrome-extension://abc/x.js:1:1)\n    at g (${origin}/assets/home-B94k2ibo.js:1:1)`,
    );
    expect(top).toBe("chrome-extension://abc/x.js");
    expect(ownScript(top!, origin)).toBeNull();
  });
});
