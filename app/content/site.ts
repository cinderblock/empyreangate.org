/**
 * Site-wide facts and links. Prose lives in `story.ts`; people in
 * `credits.ts`; the photo slots in `gallery.ts`.
 */

export const SITE = {
  name: "The Empyrean Gate",
  /** The canonical address. Canonical links and the sitemap always use it. */
  url: "https://empyreangate.org",
  /**
   * Where this particular build is served: `url` in production, the
   * Preview's own subdomain otherwise. For things that must load from the
   * page's host, like the social card image.
   */
  origin: __SITE_ORIGIN__,
  tagline: "A ring of light above the dance floor.",
  description:
    "The Empyrean Gate is a sixty-foot ring of twenty-four thousand lights lofted over a gateway, with a fire beneath it. Built by the Entheos community for Burning Man 2022, it has come back every year since.",
  /** The gate's software, open source. */
  software: "https://github.com/TomSawyerLabs/empyrean-gate",
  /** The patch engine (Rust crate) and the node editor (TypeScript), in that repo. */
  engine:
    "https://github.com/TomSawyerLabs/empyrean-gate/tree/master/crates/empyrean-patch",
  editor:
    "https://github.com/TomSawyerLabs/empyrean-gate/tree/master/packages/patch-web",
  /** This site's source. */
  source: "https://github.com/cinderblock/empyreangate.org",
  donate: "https://www.givsum.com/charities/entheos-community-village",
  entheos: {
    home: "https://www.entheosrising.org/",
    gate: "https://www.entheosrising.org/empyrean-gate-art-installation",
    instagram: "https://www.instagram.com/entheosrising/",
    instagramHandle: "entheosrising",
  },
  /**
   * A hashtag feed is deferred (see plans/empyreangate-site.md, "Later");
   * until a tag is chosen the page only points at the Entheos account.
   */
  instagramTag: null as string | null,
  /** The pattern playground: the gate's editor and engine, in the browser. */
  playground: "/playground",
  nextEvent: {
    name: "Burning Man Decompression",
    venue: "The Loom, Oakland",
    /** ISO date, for structured data. */
    date: "2026-10-17",
    when: "Saturday, October 17, 2026",
    url: "https://burningman.org/decompression",
  },
} as const;

/** The array, in numbers. Mirrors the engine's default geometry. */
export const ARRAY = {
  spokes: 64,
  pixelsPerSpoke: 378,
  pixels: 64 * 378,
  controllers: 16,
  universes: 192,
  fps: 60,
  ringDiameterFt: 50,
  canopyDiameterFt: 60,
  canopyHeightFt: 21,
  gatewayHeightFt: 13,
} as const;

/** The pattern playground's submissions. */
export const PLAYGROUND = {
  /**
   * Cloudflare Turnstile site key (public). Submit stays hidden while it is
   * empty. `VITE_TURNSTILE_SITE_KEY` overrides it,
   * e.g. with Turnstile's always-pass test key (1x00000000000000000000AA) in
   * development.
   */
  turnstileSiteKey:
    (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ??
    // The widget "empyreangate.org playground", created by ops
    // (cloudflare/config/projects/empyreangate.yaml): empyreangate.org and
    // dev.empyreangate.org.
    "0x4AAAAAAFY1sKqix3RSY_TJ",
  /**
   * What a submitter agrees to (Cameron, 2026-10-16: a licence to us, and
   * credit when we show it). Shown next to the checkbox, stored with each
   * submission as `agreed: true`.
   */
  /**
   * Chrome's WebMCP origin trial (public, not a secret): turns WebMCP on for
   * every Chrome visitor, so the playground's agent tools reach the
   * browser's own agent without a flag. Registered by Cameron 2026-10-17 at
   * developer.chrome.com/origintrials for https://empyreangate.org with
   * subdomains (so dev.empyreangate.org too). The trial runs Chrome 149–162;
   * this token expires 2027-03-30. Renew it there, or drop it if WebMCP
   * ships by default.
   */
  webmcpOriginTrial:
    "ArwfyyDmJrBtvrh91gQz302343KKQirmlWwSRLp+8P8K4yJN3jeSGz2QQi48TRAO4j38ULhov3Csz14ZB5+s4woAAABjeyJvcmlnaW4iOiJodHRwczovL2VtcHlyZWFuZ2F0ZS5vcmc6NDQzIiwiZmVhdHVyZSI6IldlYk1DUCIsImV4cGlyeSI6MTgwNjM2NDgwMCwiaXNTdWJkb21haW4iOnRydWV9",
  terms:
    "I made this pattern, or have the right to share it. I give The Empyrean Gate's crew a non-exclusive, perpetual, royalty-free licence to play it on the gate, adapt it, and share it and recordings of it. When it's shown, I'd like to be credited by the name above.",
} as const;
