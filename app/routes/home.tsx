import type { MetaFunction } from "react-router";
import GateRender from "../components/GateRender";
import { CREW, EARLIER } from "../content/credits";
import { PHOTOS } from "../content/gallery";
import { PHOTO_MANIFEST } from "../content/photo-manifest";
import { ARRAY, SITE } from "../content/site";
import {
  APPEARANCES,
  GALLERY,
  HERO,
  LIGHT,
  PEOPLE,
  PIECE,
  WHERE,
  type Paragraph,
  type Section,
} from "../content/story";

export const meta: MetaFunction = () => {
  const title = SITE.name;
  const description = SITE.description;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: SITE.name },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: `${SITE.url}/` },
    { property: "og:image", content: `${SITE.url}/og.png` },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: `${SITE.url}/og.png` },
    { tagName: "link", rel: "canonical", href: `${SITE.url}/` },
  ];
};

const NAV = [
  { href: `#${PIECE.id}`, label: "The piece" },
  { href: `#${LIGHT.id}`, label: "The light" },
  { href: `#${WHERE.id}`, label: "Where" },
  { href: `#${GALLERY.id}`, label: "Photos" },
  { href: `#${PEOPLE.id}`, label: "People" },
  { href: "#donate", label: "Donate" },
];

const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "VisualArtwork",
      name: SITE.name,
      url: `${SITE.url}/`,
      description: SITE.description,
      artform: "Light installation",
      dateCreated: "2022",
      creator: {
        "@type": "Organization",
        name: "Entheos",
        url: SITE.entheos.home,
      },
      width: {
        "@type": "QuantitativeValue",
        value: ARRAY.canopyDiameterFt,
        unitCode: "FOT",
      },
    },
    {
      "@type": "Event",
      name: `${SITE.name} at ${SITE.nextEvent.name}`,
      startDate: SITE.nextEvent.date,
      url: SITE.nextEvent.url,
      eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      location: { "@type": "Place", name: SITE.nextEvent.venue },
      performer: {
        "@type": "Organization",
        name: "Entheos",
        url: SITE.entheos.home,
      },
    },
  ],
};

function External({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a href={href} rel="noopener" target="_blank">
      {children}
    </a>
  );
}

function Prose({ paragraphs }: { paragraphs: Paragraph[] }) {
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i}>
          {p.text}
          {p.link && (
            <>
              {" "}
              {p.link.external ? (
                <External href={p.link.href}>{p.link.label} ↗</External>
              ) : (
                <a href={p.link.href}>{p.link.label}</a>
              )}
            </>
          )}
        </p>
      ))}
    </>
  );
}

function SectionHead({
  id,
  section,
}: {
  id: string;
  section: Pick<Section, "kicker" | "heading">;
}) {
  return (
    <header className="section-head">
      <p className="kicker">{section.kicker}</p>
      <h2 id={`${id}-h`}>{section.heading}</h2>
    </header>
  );
}

/** A photo slot: the real picture when its original is in `photos/`, else a labelled frame. */
function PhotoSlot({ photo }: { photo: (typeof PHOTOS)[number] }) {
  const asset = photo.asset ? PHOTO_MANIFEST[photo.asset] : undefined;
  if (!asset || !photo.asset) {
    return (
      <div className="photo-frame" data-slot={photo.slot}>
        <span className="photo-slot">Photo coming: {photo.slot}</span>
      </div>
    );
  }
  const name = photo.asset;
  const largest = asset.widths[asset.widths.length - 1];
  return (
    <a
      className="photo-link"
      href={`/photos/${name}-${largest}.webp`}
      aria-label={`${photo.caption} (full size)`}
    >
      <picture>
        <source
          type="image/webp"
          srcSet={asset.widths
            .map((w) => `/photos/${name}-${w}.webp ${w}w`)
            .join(", ")}
          sizes="(min-width: 60rem) 33vw, (min-width: 40rem) 50vw, 100vw"
        />
        <img
          src={`/photos/${name}-${asset.jpg}.jpg`}
          alt={photo.caption}
          width={asset.width}
          height={asset.height}
          loading="lazy"
          decoding="async"
        />
      </picture>
    </a>
  );
}

const nf = new Intl.NumberFormat("en-US");

export default function Home() {
  return (
    <>
      <header className="site-header">
        <a
          className="wordmark"
          href="#top"
          aria-label={`${SITE.name}, top of page`}
        >
          Empyrean&nbsp;Gate
        </a>
        <nav aria-label="Sections">
          <ul>
            {NAV.map((n) => (
              <li key={n.href}>
                <a
                  href={n.href}
                  className={n.href === "#donate" ? "nav-donate" : undefined}
                >
                  {n.label}
                </a>
              </li>
            ))}
            <li>
              <External href={SITE.software}>Code ↗</External>
            </li>
          </ul>
        </nav>
      </header>

      <main id="main">
        <section className="hero" id="top" aria-labelledby="hero-heading">
          <div className="hero-copy">
            <p className="kicker">{HERO.kicker}</p>
            <h1 id="hero-heading">{HERO.heading}</h1>
            <p className="lede">{HERO.lede}</p>
            <p className="sub">{HERO.sub}</p>
            <p className="hero-next">
              <span className="hero-next-label">Next</span>{" "}
              <External href={SITE.nextEvent.url}>
                {SITE.nextEvent.name} · {SITE.nextEvent.venue} ·{" "}
                <time dateTime={SITE.nextEvent.date}>
                  {SITE.nextEvent.when}
                </time>
              </External>
            </p>
            <div className="hero-actions">
              <a className="button" href={`#${PIECE.id}`}>
                About the gate
              </a>
              <External href={SITE.software}>
                <span className="button button-ghost">The software ↗</span>
              </External>
            </div>
          </div>
          <GateRender className="hero-render" />
        </section>

        <section
          className="section"
          id={PIECE.id}
          aria-labelledby={`${PIECE.id}-h`}
        >
          <SectionHead id={PIECE.id} section={PIECE} />
          <div className="section-body">
            <Prose paragraphs={PIECE.paragraphs} />
          </div>
          <dl className="facts" aria-label="Dimensions">
            <div>
              <dt>Canopy</dt>
              <dd>{ARRAY.canopyDiameterFt} ft across</dd>
            </div>
            <div>
              <dt>Lofted</dt>
              <dd>{ARRAY.canopyHeightFt} ft up</dd>
            </div>
            <div>
              <dt>Gateway</dt>
              <dd>{ARRAY.gatewayHeightFt} ft tall</dd>
            </div>
            <div>
              <dt>Ring of light</dt>
              <dd>{ARRAY.ringDiameterFt} ft across</dd>
            </div>
          </dl>
        </section>

        <section
          className="section"
          id={LIGHT.id}
          aria-labelledby={`${LIGHT.id}-h`}
        >
          <SectionHead id={LIGHT.id} section={LIGHT} />
          <div className="section-body">
            <Prose paragraphs={LIGHT.paragraphs} />
            {SITE.interactiveUrl ? (
              <p>
                <External href={SITE.interactiveUrl}>
                  Play with the full engine in your browser ↗
                </External>
              </p>
            ) : (
              <p className="muted">
                A site where you can play with the full engine in your browser
                is in the works.
              </p>
            )}
          </div>
          <dl className="facts" aria-label="The array in numbers">
            <div>
              <dt>Spokes</dt>
              <dd>{ARRAY.spokes}</dd>
            </div>
            <div>
              <dt>Pixels</dt>
              <dd>{nf.format(ARRAY.pixels)}</dd>
            </div>
            <div>
              <dt>Controllers</dt>
              <dd>{ARRAY.controllers}</dd>
            </div>
            <div>
              <dt>sACN universes</dt>
              <dd>
                {ARRAY.universes} at {ARRAY.fps} fps
              </dd>
            </div>
          </dl>
        </section>

        <section
          className="section"
          id={WHERE.id}
          aria-labelledby={`${WHERE.id}-h`}
        >
          <SectionHead id={WHERE.id} section={WHERE} />
          <ol className="timeline">
            {APPEARANCES.map((a, i) => (
              <li key={i} className={a.upcoming ? "upcoming" : undefined}>
                <span className="timeline-year">{a.year}</span>
                <span className="timeline-event">
                  <strong>{a.event}</strong>
                  <span className="timeline-place">{a.place}</span>
                  {a.note && <span className="timeline-note">{a.note}</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section
          className="section"
          id={GALLERY.id}
          aria-labelledby={`${GALLERY.id}-h`}
        >
          <SectionHead id={GALLERY.id} section={GALLERY} />
          <ul className="gallery">
            {PHOTOS.map((photo) => (
              <li
                key={photo.slot}
                className={`gallery-item ${photo.orientation}`}
              >
                <figure className="photo">
                  <PhotoSlot photo={photo} />
                  <figcaption>{photo.caption}</figcaption>
                </figure>
              </li>
            ))}
          </ul>
          <p className="gallery-cta">
            {GALLERY.instagramLede}{" "}
            <External href={SITE.entheos.instagram}>
              @{SITE.entheos.instagramHandle}
            </External>
            {SITE.instagramTag && <> · #{SITE.instagramTag}</>}
          </p>
        </section>

        <section
          className="section donate"
          id="donate"
          aria-labelledby="donate-h"
        >
          <header className="section-head">
            <p className="kicker">Keep the light alive</p>
            <h2 id="donate-h">A gift for the gate.</h2>
          </header>
          <div className="section-body">
            <p>
              Help keep this gathering place glowing. Your contribution supports
              the care, creativity, and work that bring the Empyrean Gate to
              life.
            </p>
            <div>
              <a
                className="button button-donate"
                href={SITE.donate}
                target="_blank"
                rel="noopener"
              >
                Donate to the gate <span aria-hidden="true">↗</span>
              </a>
            </div>
            <p className="donate-note">
              Contributions of every size are welcome.
            </p>
          </div>
        </section>

        <section
          className="section"
          id={PEOPLE.id}
          aria-labelledby={`${PEOPLE.id}-h`}
        >
          <SectionHead id={PEOPLE.id} section={PEOPLE} />
          <div className="section-body">
            <p>{PEOPLE.lede}</p>
          </div>
          <div className="people">
            <div>
              <h3>{PEOPLE.crewHeading}</h3>
              <ul className="crew">
                {CREW.map((p) => (
                  <li key={p.name}>
                    {p.href ? (
                      <External href={p.href}>{p.name}</External>
                    ) : (
                      p.name
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>{PEOPLE.earlierHeading}</h3>
              <ul className="earlier">
                {EARLIER.map((p) => (
                  <li key={p.name}>
                    <span className="person-name">{p.name}</span>
                    {p.role && <span className="person-role">{p.role}</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <p>
          {SITE.name} is a project of{" "}
          <External href={SITE.entheos.home}>Entheos</External>.
        </p>
        <p>
          <External href={SITE.software}>Gate software</External> ·{" "}
          <External href={SITE.source}>This site's source</External> ·{" "}
          <External href={SITE.entheos.instagram}>Instagram</External>
        </p>
      </footer>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
      />
    </>
  );
}
