import { Page } from "../components/page";
import { EMAIL, repoDoc } from "../lib/site";

export function Privacy() {
  return (
    <Page
      eyebrow="Privacy"
      title="The operator controls the data."
      intro="LaunchReadyy Community is self-hosted. There is no LaunchReadyy-hosted account service that receives repository data from Community installations."
    >
      <section>
        <h2>Community data</h2>
        <p>
          Repository metadata, scan results, findings, job history, and saved configuration remain
          in the operator's local SQLite database. Credentials are read by the Community server and
          are not meant to be sent to browser clients.
        </p>
      </section>
      <section>
        <h2>Configured providers</h2>
        <p>
          Community contacts GitHub for repository operations. If an operator enables isolated
          verification or AI-assisted features, relevant data may be sent directly to the providers
          they configure under those providers' terms.
        </p>
        <p>
          Credentials for those providers belong to the operator, and any quota or billing is
          handled between the operator and the provider.
        </p>
      </section>
      <section>
        <h2>This public website</h2>
        <p>
          This site is static. It has no account system, database, sessions, background jobs, or
          application telemetry. Standard hosting and network logs may still be processed by the
          hosting platform.
        </p>
        <p>
          One third-party request leaves your browser: the star counter asks the public GitHub API
          for this repository's star count, so GitHub sees your IP address for that request and
          answers with a number that is then cached in your browser. Blocking it changes nothing
          else on the page.
        </p>
      </section>
      <section>
        <h2>Questions</h2>
        <p>
          Each operator controls their own instance and its data. For questions about the official
          project, contact <a href={`mailto:${EMAIL}`}>{EMAIL}</a>. The complete data-handling model
          is documented in the{" "}
          <a href={repoDoc("reference/16-security.md")} target="_blank" rel="noreferrer">
            security reference
          </a>
          .
        </p>
      </section>
    </Page>
  );
}
