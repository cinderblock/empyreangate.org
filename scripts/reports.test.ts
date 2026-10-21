import { describe, expect, test } from "bun:test";
import {
  countsQuery,
  DATASET,
  describeReport,
  formatCounts,
  type ReportRecord,
} from "./reports";

const report: ReportRecord = {
  id: "0f3c9b2e-1111-2222-3333-444444444444",
  receivedAt: "2026-10-21T18:04:12.000Z",
  code: "webgpu-start",
  summary: "The playground's live preview didn't start.",
  message: "GPUDevice was lost",
  page: "/playground/",
  build: "f6f02be01234",
  browser: "Mozilla/5.0 (Test)",
  webgpu: "nvidia, ampere",
  webgl: "WebGL2: ANGLE (NVIDIA)",
  screen: "1280×720 at 1×",
  note: "It flickered\nfirst.",
  contact: "",
  site: "dev.empyreangate.org",
};

describe("countsQuery", () => {
  test("reads the dataset over the asked days, kept within 1–90", () => {
    expect(countsQuery(7)).toContain(`FROM ${DATASET}`);
    expect(countsQuery(7)).toContain("INTERVAL '7' DAY");
    expect(countsQuery(0)).toContain("INTERVAL '1' DAY");
    expect(countsQuery(1000)).toContain("INTERVAL '90' DAY");
  });
});

describe("describeReport", () => {
  test("says what, where, on which build, and the note on one line", () => {
    const text = describeReport(report);
    expect(text).toContain(
      "2026-10-21 18:04  webgpu-start on dev.empyreangate.org/playground/ (build f6f02be01234)",
    );
    expect(text).toContain("Note: “It flickered first.”");
    expect(text).not.toContain("Contact:");
  });
});

describe("formatCounts", () => {
  test("a table, most first, then what each failure means", () => {
    const text = formatCounts([
      {
        code: "webgpu-unavailable",
        build: "f6f02be01234",
        site: "empyreangate.org",
        count: 12,
        last: "2026-10-21 18:00:00",
      },
      {
        code: "page-stuck",
        build: "f6f02be01234",
        site: "empyreangate.org",
        count: 1,
        last: "2026-10-21 17:00:00",
      },
    ]);
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^count\s+failure\s+build\s+site\s+last$/);
    expect(lines[1]).toMatch(/^12\s+webgpu-unavailable\s+f6f02be01234/);
    expect(text).toContain("page-stuck: The page didn't finish loading.");
  });

  test("says so when there is nothing", () => {
    expect(formatCounts([])).toBe("No failures counted.");
  });
});
