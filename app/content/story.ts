/**
 * The site's prose, as data, so it can be edited without touching layout.
 * Each section is a heading plus paragraphs; a paragraph may carry inline
 * links by name (see `Prose` in home.tsx).
 */

export interface Paragraph {
  text: string;
  /** Optional link rendered after the text. */
  link?: { label: string; href: string; external?: boolean };
}

export interface Section {
  id: string;
  kicker: string;
  heading: string;
  paragraphs: Paragraph[];
}

export const HERO = {
  kicker: "Entheos · Black Rock City and beyond",
  heading: "The Empyrean Gate",
  lede: "Sixty-four spokes of light. Twenty-four thousand pixels. One gateway, with a fire beneath it.",
  sub: "Built by the Entheos community for Burning Man 2022, and back every year since.",
};

export const PIECE: Section = {
  id: "piece",
  kicker: "The piece",
  heading: "A canopy by day. A ring of light by night.",
  paragraphs: [
    {
      text: "The Empyrean Gate is a sixty-foot shade structure lofted twenty-one feet above the ground, with a thirteen-foot gateway at its centre. Beneath the gateway, the fire: some years the Empyrean cauldron, hung a foot off the ground; every year, the people who gather under the ring. By day the canopy shades a civic plaza at the Entheos camp. After dark it becomes a fifty-foot ring of light over a dance floor.",
    },
    {
      text: "Empyrean is the highest heaven: the sphere of fire in the old cosmologies, from the Greek empyros, “in the fire.” The gate is a threshold between the ground and that sky, and whatever burns beneath it is what joins them.",
    },
    {
      text: "Entheos conceived it as a place that invites contemplation: of self, of others, and of collaborative purpose. It is also, most nights, where people dance.",
      link: {
        label: "The Entheos community",
        href: "https://www.entheosrising.org/",
        external: true,
      },
    },
  ],
};

export const LIGHT: Section = {
  id: "light",
  kicker: "The light",
  heading: "Every frame, computed from scratch.",
  paragraphs: [
    {
      text: "Sixty-four spokes of high-density addressable LED run from the rim of the canopy in toward the gateway: 378 pixels each, 24,192 in all, fed by sixteen pixel controllers over sACN at sixty frames a second.",
    },
    {
      text: "The gate runs on an open-source software stack written for it. A GPU renders a stack of layers for every pixel on every frame: noise fields, harmonic rings, spirals, fire, sparkles, chases, and more, each a pure function of a pixel’s place on the ring, blended and pushed to the wire with no allocations in the loop. The DJ’s audio drives it. Beat tracking and band energies steer the layers, and a direct link to the decks keeps it on the grid even when the DJ is only in headphones.",
      link: {
        label: "Read the source",
        href: "https://github.com/TomSawyerLabs/empyrean-gate",
        external: true,
      },
    },
    {
      text: "Every screen on the local network is an equal client: the operator’s desktop, a laptop at the booth, the crew’s phones. A public page lets visitors draw on the gate with a finger, drop effects, and play games on it from their own phone, standing under it.",
    },
    {
      text: "The render at the top of this page is a browser port of a few of those same layers on the same geometry. Tap it. The real thing runs them on a GPU at the gate, where every dot is a light in the air.",
    },
  ],
};

export interface Appearance {
  /**
   * When, as shown: the month of the first day ("Aug 2022", "May 2023"), or
   * the full date of a one-day event ("Oct 17, 2026").
   */
  when: string;
  /** Sortable ISO date of the first day, for structured data later. */
  date: string;
  event: string;
  place: string;
  note?: string;
  /** An outside record of the appearance, rendered after the note. */
  link?: { label: string; href: string };
  /** Marks the next date rather than a past one. */
  upcoming?: boolean;
}

/**
 * Where the gate has been. Keep this honest: an entry here is a claim.
 *
 * unSCruz: 2023, 2024, 2025 (confirmed by Cameron; May 4–7, May 2–5, May 1–3).
 * Love Burn: once, in 2024 (confirmed by Cameron). Burning Man runs the last
 * week of August into September; it shows as "Aug", the month it starts, like
 * every other entry. In 2023 the gate was a placed art piece (Cameron); the
 * Burning Man Art Archive lists it that year and no other.
 *
 * Newest first, the order the page shows them: add a new date at the top.
 */
export const APPEARANCES: Appearance[] = [
  {
    when: "Oct 17, 2026",
    date: "2026-10-17",
    event: "Burning Man Decompression",
    place: "The Loom, Oakland, California",
    note: "Next.",
    upcoming: true,
  },
  {
    when: "Aug 2026",
    date: "2026-08-30",
    event: "Burning Man",
    place: "Black Rock City, Nevada",
  },
  {
    when: "Aug 2025",
    date: "2025-08-24",
    event: "Burning Man",
    place: "Black Rock City, Nevada",
  },
  {
    when: "May 2025",
    date: "2025-05-01",
    event: "unSCruz",
    place: "Santa Cruz, California",
  },
  {
    when: "Aug 2024",
    date: "2024-08-25",
    event: "Burning Man",
    place: "Black Rock City, Nevada",
  },
  {
    when: "May 2024",
    date: "2024-05-02",
    event: "unSCruz",
    place: "Santa Cruz, California",
  },
  {
    when: "Feb 2024",
    date: "2024-02-15",
    event: "Love Burn",
    place: "Miami, Florida",
  },
  {
    when: "Aug 2023",
    date: "2023-08-27",
    event: "Burning Man",
    place: "Black Rock City, Nevada",
    note: "A placed art piece.",
    link: {
      label: "In the Burning Man Art Archive",
      href: "https://history.burningman.org/art-history/archive/?yyyy=2023#a2I8X00000hDPVeUAO",
    },
  },
  {
    when: "May 2023",
    date: "2023-05-04",
    event: "unSCruz",
    place: "Santa Cruz, California",
    note: "First trip off the playa, to the Santa Cruz regional.",
  },
  {
    when: "Aug 2022",
    date: "2022-08-28",
    event: "Burning Man",
    place: "Black Rock City, Nevada",
    note: "The core structure is raised for the first time at the Entheos plaza.",
  },
];

export const WHERE = {
  id: "where",
  kicker: "Where it has been",
  heading: "Back every year since 2022.",
};

export const GALLERY = {
  id: "photos",
  kicker: "Photos",
  heading: "Under the ring.",
  instagramLede: "Were you there? Share your photos with",
  crewLede:
    "The gate is built, hauled, raised, lit and taken down again by volunteers from the Entheos community.",
};

export const PEOPLE = {
  id: "people",
  kicker: "People",
  heading: "Made by a community.",
  lede: "The gate is built, hauled, raised, lit and taken down again by volunteers from the Entheos community. These are the hands behind it today, and the ones it was built on.",
  crewHeading: "The gate today",
  earlierHeading: "Earlier contributors",
  donorsHeading: "Major donors",
};
