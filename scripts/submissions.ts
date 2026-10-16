/**
 * Pull the playground's submissions out of the R2 bucket for review.
 *
 *   bun run submissions            new submissions since last time, then the list
 *   bun run submissions --all      re-download everything
 *
 * Each submission is one JSON object the Worker wrote (worker/index.ts):
 * who sent it, when, and the patch. This downloads them into `submissions/`
 * (gitignored), writes each patch on its own as `submissions/patches/<name>.json`
 * (the gate's Patch tab opens those with Open file), and prints the queue.
 *
 * Needs an API token that can read the bucket (Account → Workers R2 Storage →
 * Read) and the account id:
 *   CLOUDFLARE_API_TOKEN (or CF_API_TOKEN), CLOUDFLARE_ACCOUNT_ID
 * Nothing here writes to Cloudflare.
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { patchFileName } from "@empyrean-gate/patch-web/files";
import type { PatchDoc } from "@empyrean-gate/patch-web/types";

export const BUCKET = "empyreangate-submissions";
export const PREFIX = "submissions/";
const OUT = "submissions";

/** What the Worker stores (worker/index.ts `record`). */
export interface SubmissionRecord {
  id: string;
  submittedAt: string;
  name: string;
  contact: string;
  message: string;
  country: string | null;
  patch: PatchDoc;
}

interface R2Object {
  key: string;
  size: number;
  uploaded: string;
}

/** Local file name for a record: sortable by time, unique by id. */
export function recordFileName(key: string): string {
  // Keys are `submissions/<date>/<ms>-<uuid>.json`; keep the leaf.
  return key.slice(key.lastIndexOf("/") + 1);
}

/** A patch file name that says who it came from, unique per submission. */
export function patchOutName(record: SubmissionRecord): string {
  const base = patchFileName(record.patch).replace(/\.json$/, "");
  const who = record.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return `${base}--${who || "anon"}--${record.id.slice(0, 8)}.json`;
}

/** One line of the review table. */
export function describe(record: SubmissionRecord): string {
  const when = record.submittedAt.slice(0, 16).replace("T", " ");
  const nodes = `${record.patch.nodes.length} nodes`;
  const contact = record.contact ? ` <${record.contact}>` : "";
  const note = record.message
    ? `  “${record.message.replace(/\s+/g, " ").slice(0, 60)}${record.message.length > 60 ? "…" : ""}”`
    : "";
  return `${when}  ${record.patch.name} (${nodes})  from ${record.name}${contact}${
    record.country ? ` [${record.country}]` : ""
  }${note}`;
}

function env(): { token: string; account: string } {
  const token = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) {
    throw new Error(
      "Set CLOUDFLARE_API_TOKEN (or CF_API_TOKEN; needs Workers R2 Storage: Read) and CLOUDFLARE_ACCOUNT_ID.",
    );
  }
  return { token, account };
}

async function api<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok)
    throw new Error(`${res.status} from ${path}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function listObjects(
  token: string,
  account: string,
): Promise<R2Object[]> {
  const out: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const q = new URLSearchParams({ prefix: PREFIX, per_page: "1000" });
    if (cursor) q.set("cursor", cursor);
    const page = await api<{
      result: R2Object[];
      result_info?: { cursor?: string; is_truncated?: boolean };
    }>(`/accounts/${account}/r2/buckets/${BUCKET}/objects?${q}`, token);
    out.push(...page.result);
    cursor = page.result_info?.is_truncated
      ? page.result_info.cursor
      : undefined;
  } while (cursor);
  return out;
}

async function getObject(
  token: string,
  account: string,
  key: string,
): Promise<string> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`${res.status} fetching ${key}`);
  return res.text();
}

async function main() {
  const all = process.argv.includes("--all");
  const { token, account } = env();
  await mkdir(join(OUT, "patches"), { recursive: true });
  const have = new Set(await readdir(OUT));
  const objects = (await listObjects(token, account)).sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  let fetched = 0;
  const records: SubmissionRecord[] = [];
  for (const o of objects) {
    const file = recordFileName(o.key);
    let text: string;
    if (all || !have.has(file)) {
      text = await getObject(token, account, o.key);
      await writeFile(join(OUT, file), text);
      fetched++;
    } else {
      text = await Bun.file(join(OUT, file)).text();
    }
    const record = JSON.parse(text) as SubmissionRecord;
    records.push(record);
    await writeFile(
      join(OUT, "patches", patchOutName(record)),
      JSON.stringify(record.patch, null, 2) + "\n",
    );
  }
  console.log(`${objects.length} submissions in ${BUCKET} (${fetched} new)\n`);
  for (const r of records) console.log(describe(r));
  if (records.length)
    console.log(`\nPatches ready to open on the gate: ${join(OUT, "patches")}`);
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
