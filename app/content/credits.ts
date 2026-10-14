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

export interface EarlierCredit {
  role: string;
  people: Person[];
  /** A studio or shop credited for the work as a whole. */
  studio?: Person;
}

/**
 * Earlier contributors whose work the gate was built on, most recent first.
 * People still involved are credited under CREW, not here.
 */
export const EARLIER: EarlierCredit[] = [
  {
    role: "Light software for unSCruz 2024",
    people: [{ name: "Eric Vicenti", href: "https://eric.vicenti.net/" }],
  },
  {
    role: "Original lighting, 2022",
    people: [{ name: "Andris Kasparovics" }],
    studio: {
      name: "Sight Unseen Studios",
      href: "https://www.sightunseenstudios.com/",
    },
  },
  {
    role: "Fabrication, 2022",
    people: [{ name: "Michael Kennedy" }, { name: "James Scott" }],
    studio: {
      name: "Kennedy Fabrications",
      href: "https://www.kennedyfabrications.com/",
    },
  },
  {
    role: "Original design, 2022",
    people: [
      { name: "Anthony Fieldman", href: "https://www.anthonyfieldman.com/" },
    ],
  },
];
