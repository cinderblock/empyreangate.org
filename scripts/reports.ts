/**
 * What the site's failures look like from here: the reports visitors sent,
 * and the anonymous failure counts.
 *
 *   bun run reports              new reports since last time, then the counts
 *   bun run reports --days 30    counts over the last 30 days (default 7)
 *   bun run reports --all        re-download every report
 *
 * Reports are JSON objects under `reports/` in the submissions bucket
 * (worker/index.ts `report`), downloaded into `reports/` here (gitignored).
 * A pattern a visitor included (under `report-patterns/`) is downloaded into
 * `reports/patterns/`, a patch file the playground's Open file loads.
 * Counts come from Workers Analytics Engine (dataset `empyreangate_failures`,
 * worker/index.ts `failure`), grouped by failure, build and site.
 *
 * Needs an API token that can read the bucket and account analytics
 * (Workers R2 Storage: Read, Account Analytics: Read) and the account id:
 *   CLOUDFLARE_API_TOKEN (or CF_API_TOKEN), CLOUDFLARE_ACCOUNT_ID
 * Nothing here writes to Cloudflare.
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FAILURE_CODES } from "../app/failure-codes";
import { env, getObject, listObjects } from "./submissions";

export const DATASET = "empyreangate_failures";
const PREFIX = "reports/";
const OUT = "reports";
const PATTERNS = join(OUT, "patterns");

/** What the Worker stores for a report (worker/index.ts `record`). */
export interface ReportRecord {
  id: string;
  receivedAt: string;
  code: string;
  summary: string;
  message: string;
  page: string;
  build: string;
  browser: string;
  webgpu: string;
  webgl: string;
  screen: string;
  /** The browser check's results, a line per test (`browser-check`). */
  selftest?: string;
  note: string;
  contact: string;
  site: string;
  /** Where the pattern the visitor included is, if they did. */
  patch?: string;
}

/** Where a report's pattern lands here: `reports/patterns/<its file>`. */
export function patternFile(key: string): string {
  return `${OUT}/patterns/${key.slice(key.lastIndexOf("/") + 1)}`;
}

/** One row of the counts: a failure (for an unexpected one, in which of
 * the site's scripts), on a build, on a site. */
export interface CountRow {
  code: string;
  /** The script an unexpected error came from; empty for the rest. */
  script: string;
  build: string;
  site: string;
  count: number;
  last: string;
}

/** The counts over the last `days` days, most frequent first. Analytics
 * Engine samples under load; `_sample_interval` weights each row back up. */
export function countsQuery(days: number): string {
  const n = Math.max(1, Math.min(90, Math.floor(days)));
  return `SELECT blob1 AS code, blob4 AS script, blob2 AS build, blob3 AS site,
  SUM(_sample_interval) AS count, MAX(timestamp) AS last
FROM ${DATASET}
WHERE timestamp > NOW() - INTERVAL '${n}' DAY
GROUP BY code, script, build, site
ORDER BY count DESC`;
}

/** A report, in a few lines. */
export function describeReport(r: ReportRecord): string {
  const when = r.receivedAt.slice(0, 16).replace("T", " ");
  const lines = [
    `${when}  ${r.code} on ${r.site}${r.page} (build ${r.build})`,
    // A visitor's own report (`user-report`) has no error, just the note.
    ...(r.message ? [`  ${r.message}`] : []),
    `  ${r.browser}`,
    `  WebGPU: ${r.webgpu}  |  ${r.webgl}  |  ${r.screen}`,
    // The browser check's results, a line per test.
    ...(r.selftest ? r.selftest.split("\n").map((l) => `  Test: ${l}`) : []),
  ];
  if (r.note) lines.push(`  Note: “${r.note.replace(/\s+/g, " ")}”`);
  if (r.contact) lines.push(`  Contact: ${r.contact}`);
  if (r.patch) lines.push(`  Pattern: ${patternFile(r.patch)}`);
  return lines.join("\n");
}

/** The counts as a table. */
export function formatCounts(rows: CountRow[]): string {
  if (!rows.length) return "No failures counted.";
  const header = ["count", "failure", "script", "build", "site", "last"];
  const body = rows.map((r) => [
    String(r.count),
    r.code,
    r.script || "-",
    r.build,
    r.site,
    r.last.slice(0, 16),
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i]!.length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i]!))
      .join("  ")
      .trimEnd();
  const known = new Set(rows.map((r) => r.code));
  return [
    line(header),
    ...body.map(line),
    "",
    ...[...known]
      .filter((c): c is keyof typeof FAILURE_CODES => c in FAILURE_CODES)
      .map((c) => `${c}: ${FAILURE_CODES[c]}`),
  ].join("\n");
}

async function queryCounts(
  token: string,
  account: string,
  days: number,
): Promise<CountRow[] | string> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: countsQuery(days),
    },
  );
  const text = await res.text();
  if (!res.ok) {
    // The dataset only exists once something has been counted.
    if (/unknown table|does not exist/i.test(text))
      return "No failures counted yet (the dataset appears with the first one).";
    return `Couldn't read the counts (${res.status}): ${text.trim()}`;
  }
  const out = JSON.parse(text) as {
    data: (Omit<CountRow, "count"> & { count: number | string })[];
  };
  return out.data.map((r) => ({ ...r, count: Number(r.count) }));
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const daysAt = args.indexOf("--days");
  const days = daysAt >= 0 ? Number(args[daysAt + 1]) || 7 : 7;
  const { token, account } = env();

  await mkdir(PATTERNS, { recursive: true });
  const have = new Set(await readdir(OUT));
  const havePatterns = new Set(await readdir(PATTERNS));
  // In the order they arrived: the leaf starts with the time.
  const leaf = (key: string) => key.slice(key.lastIndexOf("/") + 1);
  const objects = (await listObjects(token, account, PREFIX)).sort((a, b) =>
    leaf(a.key).localeCompare(leaf(b.key)),
  );
  let fetched = 0;
  const records: ReportRecord[] = [];
  for (const o of objects) {
    const file = leaf(o.key);
    let text: string;
    if (all || !have.has(file)) {
      text = await getObject(token, account, o.key);
      await writeFile(join(OUT, file), text);
      fetched++;
    } else {
      text = await Bun.file(join(OUT, file)).text();
    }
    const record = JSON.parse(text) as ReportRecord;
    records.push(record);
    if (record.patch && (all || !havePatterns.has(leaf(record.patch)))) {
      await writeFile(
        patternFile(record.patch),
        await getObject(token, account, record.patch),
      );
    }
  }
  console.log(`${objects.length} reports (${fetched} new)\n`);
  for (const r of records) console.log(`${describeReport(r)}\n`);

  console.log(`Failures counted in the last ${days} days:\n`);
  const counts = await queryCounts(token, account, days);
  console.log(typeof counts === "string" ? counts : formatCounts(counts));
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
