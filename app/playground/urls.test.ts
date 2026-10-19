import { describe, expect, test } from "bun:test";
import { parsePlaygroundPath, playgroundPath } from "./urls";

describe("playground URLs", () => {
  test("round-trip patches, built-ins and sub-patch paths", () => {
    for (const loc of [
      { patch: "4f1c-uuid", path: [] },
      { patch: "builtin-rainbow-sparkle", path: [] },
      { patch: "4f1c-uuid", path: ["n3", "n7"] },
      { patch: "builtin-noise-garden", path: ["n2"] },
    ]) {
      expect(parsePlaygroundPath(playgroundPath(loc))).toEqual(loc);
    }
    expect(playgroundPath({ patch: "builtin-scope", path: ["n1"] })).toBe(
      "/playground/builtin/scope/n1",
    );
    expect(playgroundPath({ patch: "", path: [] })).toBe("/playground/");
  });

  test("anything else is not a location", () => {
    expect(parsePlaygroundPath("/playground/")).toBeNull();
    expect(parsePlaygroundPath("/playground")).toBeNull();
    expect(parsePlaygroundPath("/playground/agents.md")).toBeNull();
    expect(parsePlaygroundPath("/playground/p/%E0%A4%A")).toBeNull();
    expect(parsePlaygroundPath("/playground/p/abc/")).toEqual({
      patch: "abc",
      path: [],
    });
  });
});
