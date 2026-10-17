/**
 * The photo gallery.
 *
 * Originals go in `photos/` (committed; see scripts/photos.ts). Each slot
 * names one by its slug: `photos/Gate Night Wide.jpg` becomes
 * `gate-night-wide`. On a Preview, a slot whose photo isn't there yet
 * renders as a labelled placeholder, so it stays obvious during review which
 * shots are still needed; production leaves it out.
 */

/** One original's web renditions, from the generated manifest. */
export interface PhotoAsset {
  /** Intrinsic size of the largest rendition. */
  width: number;
  height: number;
  /** WebP widths available as `/photos/<name>-<w>.webp`. */
  widths: number[];
  /** Width of the JPEG fallback, `/photos/<name>-<jpg>.jpg`. */
  jpg: number;
}

export interface Photo {
  slot: string;
  caption: string;
  /** Portrait slots get a taller frame in the grid. */
  orientation: "landscape" | "portrait";
  /** Slug of the original in `photos/`. */
  asset?: string;
}

export const PHOTOS: Photo[] = [
  {
    slot: "night-wide",
    caption: "The ring at night from the dance floor.",
    orientation: "landscape",
    asset: "unscruz-2024-night-warm",
  },
  {
    slot: "gateway-fire",
    caption: "The gateway, and the fire beneath it.",
    orientation: "portrait",
  },
  {
    slot: "day-canopy",
    caption: "The canopy by day, shading the plaza.",
    orientation: "landscape",
  },
  {
    slot: "crowd-under",
    caption: "Looking straight up from under the centre.",
    orientation: "portrait",
  },
  {
    slot: "build",
    caption: "Raising it.",
    orientation: "landscape",
    asset: "unscruz-2024-night-cool",
  },
  {
    slot: "regional",
    caption: "On the road.",
    orientation: "landscape",
  },
];
