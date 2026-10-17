/**
 * One-shot setup of the Worker's secrets, on production and on the dev Preview:
 *
 *   TURNSTILE_SECRET    read from the Turnstile widget ops created
 *                       ("empyreangate.org playground"), through the read-only
 *                       token in the ops checkout's cloudflare/.env.local
 *   VAPID_PUBLIC_KEY    a fresh pair (worker/webpush.ts), generated here
 *   VAPID_PRIVATE_KEY
 *   ADMIN_TOKEN         generated here and PRINTED at the end: it is what the
 *                       crew types into /admin. Keep it somewhere safe.
 *
 * Needs `wrangler login` first (an OAuth approval in your browser; the
 * workstation deliberately holds no edit-capable API token). Then:
 *
 *   bunx wrangler login
 *   bun run secrets:setup            # both production and the "dev" Preview
 *   bun run secrets:setup --only=preview   # or --only=production
 *
 * Idempotent in the sense that running it again replaces every value: the
 * admin token changes, and every enrolled device keeps working only if the
 * VAPID keys stay the same, so do not re-run it casually once devices are
 * enrolled. Generated values never touch the disk except a temp file that
 * is deleted right after upload.
 */

import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateVapidKeys } from "../worker/webpush";

const WORKER = "empyreangate-org";
const PREVIEW = "dev";
const WIDGET_NAME = "empyreangate.org playground";
const OPS_ENV = join(
  process.env.USERPROFILE ?? process.env.HOME ?? "",
  "git",
  "Personal Projects",
  "ops",
  "cloudflare",
  ".env.local",
);

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

function readOpsEnv(): { token: string; account: string } {
  let text = "";
  try {
    text = readFileSync(OPS_ENV, "utf8");
  } catch {
    text = "";
  }
  const vars = Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l: string) => /^[A-Z_]+=/.test(l))
      .map((l: string) => {
        const [k, ...rest] = l.split("=");
        return [k, rest.join("=").trim().replace(/^"|"$/g, "")];
      }),
  ) as Record<string, string>;
  const token = vars.CF_API_TOKEN ?? vars.CLOUDFLARE_API_TOKEN ?? "";
  const account = vars.CLOUDFLARE_ACCOUNT_ID ?? "";
  if (!token || !account) {
    throw new Error(`No CF_API_TOKEN / CLOUDFLARE_ACCOUNT_ID in ${OPS_ENV}`);
  }
  return { token, account };
}

/** The widget's secret, by name, through the read-only ops token. */
async function turnstileSecret(): Promise<{ sitekey: string; secret: string }> {
  const { token, account } = readOpsEnv();
  const headers = { authorization: `Bearer ${token}` };
  const list = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/challenges/widgets?per_page=50`,
    { headers },
  );
  const widgets =
    ((await list.json()) as { result?: { name: string; sitekey: string }[] })
      .result ?? [];
  const widget = widgets.find((w) => w.name === WIDGET_NAME);
  if (!widget)
    throw new Error(
      `No Turnstile widget named "${WIDGET_NAME}" (ops creates it)`,
    );
  const detail = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/challenges/widgets/${widget.sitekey}`,
    { headers },
  );
  const result = ((await detail.json()) as { result?: { secret?: string } })
    .result;
  if (!result?.secret)
    throw new Error("The widget's secret is not readable with this token");
  return { sitekey: widget.sitekey, secret: result.secret };
}

async function run(args: string[], input?: string): Promise<void> {
  // The login spans several accounts; the ops env names the one the worker
  // lives in, and wrangler cannot ask when it is not on a terminal.
  const { account } = readOpsEnv();
  const proc = Bun.spawn(["bunx", "wrangler", ...args], {
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: account },
    stdin: input === undefined ? "inherit" : new Blob([input]),
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0)
    throw new Error(`wrangler ${args.join(" ")} exited with ${code}`);
}

const { sitekey, secret } = await turnstileSecret();
const vapid = await generateVapidKeys();
const adminToken = crypto.randomUUID().replace(/-/g, "");
const secrets: Record<string, string> = {
  TURNSTILE_SECRET: secret,
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  ADMIN_TOKEN: adminToken,
};

if (only !== "preview") {
  const dir = await mkdtemp(join(tmpdir(), "egsecrets-"));
  const file = join(dir, "secrets.json");
  try {
    await writeFile(file, JSON.stringify(secrets), { mode: 0o600 });
    console.log(`\nProduction worker ${WORKER}:`);
    // Pre-launch, master builds upload versions that are never deployed, and
    // `secret bulk` refuses while the latest version is not live. The
    // versions form makes a new version carrying the secrets, still without
    // deploying anything.
    await run([
      "versions",
      "secret",
      "bulk",
      file,
      "--name",
      WORKER,
      "--message",
      "secrets (bun run secrets:setup)",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
if (only !== "production") {
  console.log(`\nPreview "${PREVIEW}" of ${WORKER}:`);
  for (const [name, value] of Object.entries(secrets)) {
    await run(
      [
        "preview",
        "secret",
        "put",
        name,
        "--name",
        PREVIEW,
        "--worker-name",
        WORKER,
      ],
      value,
    );
  }
}

console.log(`
Done. The Turnstile sitekey is ${sitekey} (public; PLAYGROUND.turnstileSiteKey
in app/content/site.ts must match it).

ADMIN_TOKEN (what the crew enters on /admin; keep it safe, it is not stored
anywhere else):

  ${adminToken}
`);
