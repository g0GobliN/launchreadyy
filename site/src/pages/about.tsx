import { Link } from "../components/link";
import { Page } from "../components/page";
import { EMAIL, REPO_URL } from "../lib/site";

export function About() {
  return (
    <Page
      eyebrow="About"
      title="Evidence for the release decision."
      intro="LaunchReadyy Community helps repository owners understand production risk before a release, without moving the application itself into a hosted service."
    >
      <section>
        <h2>Why it exists</h2>
        <p>
          Production readiness is usually spread across code review, CI logs, configuration,
          security checks, and tribal knowledge. LaunchReadyy collects those signals, attaches
          evidence, and turns them into a practical set of next actions.
        </p>
        <p>
          The output is deliberately conservative. A finding names the file or configuration it came
          from, and a score is a summary of evidence rather than a verdict.
        </p>
      </section>
      <section>
        <h2>Community architecture</h2>
        <p>
          The product is self-hosted and single-operator. You run the Node application, connect
          repositories with your own credentials, and keep persistent data in your local database.
          This website is a separate static project and does not run scans.
        </p>
        <p>
          Optional providers extend it rather than enable it: sandbox verification and AI-assisted
          changes are additive, and every other capability works without them.
        </p>
      </section>
      <section>
        <h2>Open source and brand</h2>
        <p>
          Community is distributed under the Apache License 2.0. Self-hosting, modification,
          redistribution, and commercial use are all permitted; the license also carries an explicit
          patent grant.
        </p>
        <p>
          The name and logos are not covered by that license. They identify the official project, so
          forks are asked to ship under their own branding. See the{" "}
          <Link href="/license">license page</Link> for both.
        </p>
      </section>
      <section>
        <h2>Project</h2>
        <p>
          Development, issues, source, and contribution guidance live in the{" "}
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            official GitHub repository
          </a>
          .
        </p>
        <p>
          General questions can be sent to <a href={`mailto:${EMAIL}`}>{EMAIL}</a>, and security
          reports should use the repository's private advisory flow.
        </p>
      </section>
    </Page>
  );
}
