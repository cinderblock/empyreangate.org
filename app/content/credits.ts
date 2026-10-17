export interface Person {
  name: string;
  /** Their own site. Only ones they publish themselves. */
  href?: string;
}

/** Ted, credited in the crew and on the photos he took. */
export const TED: Person = {
  name: "Theodore Wahrburg",
  href: "https://ted.wahrburg.dev/",
};

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
  TED,
];

export interface EarlierCredit {
  role: string;
  people: Person[];
  /** The studio, shop or project credited for the work as a whole. */
  byline?: Person;
}

/**
 * Earlier contributors whose work the gate was built on, most recent first.
 * People still involved are credited under CREW, not here.
 */
export const EARLIER: EarlierCredit[] = [
  {
    role: "Light software for unSCruz 2024",
    people: [{ name: "Eric Vicenti", href: "https://eric.vicenti.net/" }],
    byline: {
      name: "Uprising",
      href: "https://github.com/ericvicenti/uprising",
    },
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
    people: [{ name: "Michael Kennedy" }, { name: "James Scott" }],
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
