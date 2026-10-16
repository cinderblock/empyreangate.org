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
   * Cloudflare Turnstile site key (public). Empty until the widget exists,
   * and Submit stays hidden until then. `VITE_TURNSTILE_SITE_KEY` overrides it,
   * e.g. with Turnstile's always-pass test key (1x00000000000000000000AA) in
   * development.
   */
  turnstileSiteKey:
    (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? "",
  /**
   * What a submitter agrees to (Cameron, 2026-10-16: a licence to us, and
   * credit when we show it). Shown next to the checkbox, stored with each
   * submission as `agreed: true`.
   */
  terms:
    "I made this pattern, or have the right to share it. I give The Empyrean Gate's crew a non-exclusive, perpetual, royalty-free licence to play it on the gate, adapt it, and share it and recordings of it. When it's shown, I'd like to be credited by the name above.",
} as const;
