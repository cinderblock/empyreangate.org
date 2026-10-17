/**
 * Checks a deployed site from the outside, read-only: the pages, the 404,
 * robots, the redirects onto the apex, that the workers.dev hostname stays
 * dark, and that the Worker has its secrets (an endpoint answers 503 until
 * they exist). Nothing is written: the empty submission is refused before
 * Turnstile or the bucket are reached.
 *
 *   bun run launch-check                         # production
 *   bun run launch-check https://dev.empyreangate.org
 *
 * A Preview is expected to be noindex and, while previews ignore
 * `not_found_handling`, to answer a miss with a bare 404; the host checks
 * (redirects, workers.dev) only run against production.
 */

// A module, for top-level await (this script imports nothing).
export {};

const PRODUCTION = "https://empyreangate.org";
const REDIRECTED = [
  "https://www.empyreangate.org/",
  "https://empyreangate.com/",
  "https://www.empyreangate.com/",
];
const WORKERS_DEV = "https://empyreangate-org.isozilla.workers.dev/";

const origin = (process.argv[2] ?? PRODUCTION).replace(/\/$/, "");
const production = origin === PRODUCTION;

let failed = 0;
function report(ok: boolean, what: string, detail: string) {
  if (!ok) failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"}  ${what}${detail ? ` (${detail})` : ""}`,
  );
}

async function get(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path.startsWith("http") ? path : `${origin}${path}`, {
    redirect: "manual",
    ...init,
  });
}

console.log(`Checking ${origin}\n`);

if ((await get("/")).status === 503) {
  console.log(
    "The home page answers 503: the site isn't deployed here yet (ops' stub),\nso every check below fails for that reason, secrets included.\n",
  );
}

for (const path of ["/", "/playground/", "/admin/"]) {
  const res = await get(path);
  report(res.status === 200, `GET ${path}`, `${res.status}`);
}

const home = await get("/");
const noindex = (home.headers.get("x-robots-tag") ?? "").includes("noindex");
report(
  noindex === !production,
  production ? "home is indexable" : "home is noindex",
  `x-robots-tag: ${home.headers.get("x-robots-tag") ?? "none"}`,
);

const robots = await (await get("/robots.txt")).text();
report(
  production ? /^Allow: \/$/m.test(robots) : /^Disallow: \/$/m.test(robots),
  production ? "robots.txt allows /" : "robots.txt disallows /",
  "",
);

const miss = await get("/nope");
const missBody = await miss.text();
report(
  miss.status === 404 && (!production || missBody.includes("Nothing here.")),
  "GET /nope is the 404 page",
  `${miss.status}`,
);

const submit = await get("/api/submit", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
report(
  submit.status === 400,
  "POST /api/submit {} is refused as incomplete",
  submit.status === 503
    ? "503: TURNSTILE_SECRET or the bucket is missing"
    : `${submit.status}`,
);

const key = await get("/api/notify/key");
report(
  key.status === 200,
  "GET /api/notify/key",
  key.status === 503
    ? "503: the VAPID keys or ADMIN_TOKEN are missing"
    : `${key.status}`,
);

if (production) {
  for (const url of REDIRECTED) {
    const res = await get(url);
    const to = res.headers.get("location") ?? "";
    report(
      res.status === 301 && to.startsWith(`${PRODUCTION}/`),
      `${url} redirects to the apex`,
      `${res.status} ${to}`,
    );
  }
  const dark = await get(WORKERS_DEV).then(
    (res) => `${res.status}`,
    () => "no answer",
  );
  report(dark !== "200", "workers.dev hostname is off", dark);
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
