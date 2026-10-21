import type { MetaFunction } from "react-router";
import { Link } from "react-router";
import { SITE } from "../content/site";

export const meta: MetaFunction = () => {
  const title = `Privacy · ${SITE.name}`;
  return [
    { title },
    {
      name: "description",
      content: "What this site learns about its visitors, and when.",
    },
    { tagName: "link", rel: "canonical", href: `${SITE.url}/privacy` },
  ];
};

/**
 * What the site collects. Each paragraph mirrors code: Web Analytics (ops),
 * failure counts and reports (app/failures.ts, app/watchdog.ts,
 * worker/index.ts), Submit (playground/SubmitDialog.tsx, worker/index.ts).
 * Change this page when any of them changes.
 */
export default function Privacy() {
  return (
    <main id="main" className="prose-page">
      <p className="kicker">Privacy</p>
      <h1>What this site learns about you</h1>
      <p className="lede">
        No cookies and no accounts. Here is everything the site learns, and
        when.
      </p>

      <h2>Visiting</h2>
      <p>
        Cloudflare Web Analytics counts page views, which site sent you here,
        your country, and how fast pages loaded. It sets no cookies and doesn't
        follow you from site to site. Cloudflare hosts the site and handles
        every request under{" "}
        <a href="https://www.cloudflare.com/privacypolicy/" rel="noopener">
          its own privacy policy
        </a>
        .
      </p>

      <h2>When something breaks</h2>
      <p>
        If part of the site fails in your browser (the home page's live render,
        the playground, a page that never finishes loading, or an error in the
        site's own code), your browser tells us which part failed and which
        version of the site it was. For an unexpected error, that part is the
        name of the site's script it came from. Nothing else: not the error's
        text, your address, your browser, or any ID. We count these to notice
        when a new version breaks something.
      </p>
      <p>
        Where a failure shows a <strong>Send a report</strong> button, pressing
        it shows you exactly what a report would carry: the error, the page,
        your browser's user-agent string, what your browser says about its
        graphics hardware, and your window size, plus any note or contact you
        add. Nothing is sent until you press Send. The crew reads reports to fix
        the site.
      </p>

      <h2>The pattern playground</h2>
      <p>
        Patterns you make stay in your browser's own storage. Nothing leaves it
        until you press Submit. A submission carries the pattern, the name,
        contact and note you type, your country and your browser's user-agent
        string, for the crew to review.
      </p>
      <p>
        Submissions and reports both pass Cloudflare Turnstile, a spam check,
        first. To cap how many one person can send in a day, each is filed under
        a scrambled form of your IP address (a keyed hash that can't be turned
        back into the address). The address itself isn't kept.
      </p>

      <h2>Questions</h2>
      <p>
        This site's code is{" "}
        <a href={SITE.source} rel="noopener">
          open source
        </a>
        , so you can check all of this. Ask us on{" "}
        <a href={SITE.entheos.instagram} rel="noopener">
          Instagram
        </a>
        .
      </p>
      <p>
        <Link to="/">Back to the gate</Link>
      </p>
    </main>
  );
}
