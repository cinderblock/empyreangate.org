export interface Person {
  name: string;
  /** Their own site. Only ones they publish themselves. */
  href?: string;
}

/**
 * Who makes the gate happen now. Names only, in the order given; the work is
 * shared enough that titles would mislead.
 */
export const CREW: Person[] = [
  { name: "The Entheos Community", href: "https://www.entheosrising.org/" },
  { name: "James Logistic" },
  {
    name: 'Cameron "Quadrangle" Tacklind',
    href: "https://cameron.tacklind.com/",
  },
  // Her GitHub: second-largest contributor to the gate's software.
  { name: "Allison Bellows", href: "https://github.com/allibell" },
  { name: "Theodore Wahrburg", href: "https://ted.wahrburg.dev/" },
];

export interface Credit {
  role: string;
  people: Person[];
  /** The studio, shop or project credited for the work as a whole. */
  byline?: Person;
}

/**
 * Earlier contributors whose work the gate was built on, most recent first.
 * People still involved are credited under CREW; James also appears here for
 * the role the panel gives him. The 2022–23 roles and the 2023 credits come
 * from the gate's own artist panel, 2023, which dates James's role no earlier.
 */
export const EARLIER: Credit[] = [
  {
    role: "Light software for unSCruz 2024",
    people: [{ name: "Eric Vicenti", href: "https://eric.vicenti.net/" }],
    byline: {
      name: "Uprising",
      href: "https://github.com/ericvicenti/uprising",
    },
  },
  {
    role: "Concept and project direction, 2023",
    people: [{ name: 'James "Logistic" Tramel' }],
  },
  {
    role: "Video sequences, 2023",
    people: [
      {
        name: "World of Kaleidoscopes",
        href: "https://www.youtube.com/@worldofkaleidoscopes2446",
      },
      { name: "HD Colors", href: "https://www.youtube.com/HDCOLORS" },
    ],
  },
  {
    role: "Sound sequences, 2023",
    people: [
      { name: "Meditative Mind" },
      { name: "Sleep Before Midnight" },
      { name: "Adrien Lacquemant" },
      { name: "Tony Grund" },
    ],
  },
  {
    role: "Fabrication, 2023",
    people: [{ name: 'James "Focus" Scott' }],
  },
  {
    role: "Music, 2022–23",
    people: [{ name: "Nati Shabat" }],
  },
  {
    role: "Audio, 2022–23",
    people: [{ name: "Abraham Fuentes" }],
  },
  {
    role: "Content, 2022–23",
    people: [{ name: "Adrien Lacquemant" }],
  },
  {
    role: "Video, 2022",
    people: [{ name: 'Walter "Rip Ions" Smith' }],
  },
  {
    role: "Lighting, 2022",
    people: [{ name: "Andris Kasparovics" }],
    byline: {
      name: "Sight Unseen Studios",
      href: "https://www.sightunseenstudios.com/",
    },
  },
  {
    role: "Fabrication, 2022",
    people: [{ name: "Michael Kennedy" }, { name: 'James "Focus" Scott' }],
    byline: {
      name: "Kennedy Fabrications",
      href: "https://www.kennedyfabrications.com/",
    },
  },
  {
    role: "Design, 2022",
    people: [
      { name: "Anthony Fieldman", href: "https://www.anthonyfieldman.com/" },
    ],
  },
];

/** The 2022 build's major donors, as the 2023 artist panel lists them. */
export const DONORS: Credit[] = [
  {
    role: "Benefactor, 2022",
    people: [{ name: "Matt Mullenweg" }],
  },
  {
    role: "Supporters, 2022",
    people: [{ name: "Ed Chimney" }, { name: "James Currier" }],
  },
  {
    role: "Fundraising, 2022",
    people: [{ name: "Whitmire Vo" }],
  },
];
