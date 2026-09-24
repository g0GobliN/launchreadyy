import { Link } from "../components/link";
import { Page } from "../components/page";
import { repoFile } from "../lib/site";

export function Terms() {
  return (
    <Page
      eyebrow="Terms"
      title="Use Community on infrastructure you control."
      intro="LaunchReadyy Community is software you install and operate. The official project does not provide hosted accounts or a managed scanning service."
    >
      <section>
        <h2>Software terms</h2>
        <p>
          The software is provided under the licensing terms in the repository. Your use,
          modification, and distribution of the project are governed by those files — see the{" "}
          <Link href="/license">license page</Link> for what the Apache-2.0 license permits and what
          the trademark policy covers.
        </p>
      </section>
      <section>
        <h2>Your responsibility</h2>
        <p>
          You are responsible for securing your instance, credentials, database, network access,
          provider accounts, and the repositories you connect. Review generated findings and changes
          before relying on or merging them.
        </p>
      </section>
      <section>
        <h2>No certification</h2>
        <p>
          Readiness results are engineering guidance, not a guarantee, penetration test, legal
          review, compliance certification, or assurance that software is safe to release.
        </p>
      </section>
      <section>
        <h2>Third parties</h2>
        <p>
          GitHub and any optional verification or AI providers you configure operate under their own
          terms, limits, and privacy practices. The project's own security policy lives in{" "}
          <a href={repoFile("SECURITY.md")} target="_blank" rel="noreferrer">
            SECURITY.md
          </a>
          .
        </p>
      </section>
    </Page>
  );
}
