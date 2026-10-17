import { describe as group, expect, test } from "bun:test";
import {
  describe,
  patchOutName,
  recordFileName,
  type SubmissionRecord,
} from "./submissions";

const record: SubmissionRecord = {
  id: "0f3c9b2e-1111-2222-3333-444444444444",
  submittedAt: "2026-10-16T18:04:12.000Z",
  name: "Ada Lovelace",
  contact: "ada@example.org",
  message: "For the sunrise set.  Slow it down a touch.",
  country: "US",
  patch: {
    format: 3,
    id: "",
    name: "Sunrise Spiral!",
    description: "",
    nodes: [
      { id: "n1", kind: "spiral", name: "", params: {}, pos: [0, 0] },
      { id: "n2", kind: "output", name: "", params: {}, pos: [1, 1] },
    ],
    edges: [],
    exposed: [],
  },
};

group("submissions", () => {
  test("keeps the Worker's leaf name for the record file", () => {
    expect(
      recordFileName("submissions/2026-10-16/1760637852000-0f3c9b2e.json"),
    ).toBe("1760637852000-0f3c9b2e.json");
    expect(
      recordFileName(
        "submissions/2026-10-18/3f9a0c1d2e4b5a69/1760800000000-0f3c9b2e.json",
      ),
    ).toBe("1760800000000-0f3c9b2e.json");
  });

  test("names the patch file after the patch, the sender and the id", () => {
    expect(patchOutName(record)).toBe(
      "sunrise-spiral--ada-lovelace--0f3c9b2e.json",
    );
    expect(patchOutName({ ...record, name: "   " })).toBe(
      "sunrise-spiral--anon--0f3c9b2e.json",
    );
  });

  test("describes a submission in one line", () => {
    expect(describe(record)).toBe(
      "2026-10-16 18:04  Sunrise Spiral! (2 nodes)  from Ada Lovelace <ada@example.org> [US]  “For the sunrise set. Slow it down a touch.”",
    );
    expect(
      describe({ ...record, contact: "", message: "", country: null }),
    ).toBe("2026-10-16 18:04  Sunrise Spiral! (2 nodes)  from Ada Lovelace");
  });
});
