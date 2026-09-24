import { Page } from "../components/page";
import { REPO_URL, repoDoc, repoFile } from "../lib/site";

export function Security() {
  return (
    <Page
      eyebrow="Security"
      title="Report vulnerabilities privately."
      intro="Security issues in LaunchReadyy Community should be reported through the repository's private GitHub security advisory flow, not a public issue."
    >
      <section>
        <h2>Reporting</h2>
        <p>
          Open the repository's{" "}
          <a href={`${REPO_URL}/security/advisories/new`} target="_blank" rel="noreferrer">
            private vulnerability report
          </a>
          . Include the impact, reproduction steps or proof of concept, and the commit you tested.
        </p>
        <p>
          The maintained policy, including what is supported, is{" "}
          <a href={repoFile("SECURITY.md")} target="_blank" rel="noreferrer">
            SECURITY.md
          </a>
          .
        </p>
      </section>
      <section>
        <h2>Security boundary</h2>
        <p>
          Community is self-hosted, so the instance and its credentials are the operator's
          responsibility. The issues that matter most are sandbox escape, server-side request
          forgery, secret disclosure, injection through repository-controlled input, and a fix
          workflow producing changes other than the reviewed diff.
        </p>
      </section>
      <section>
        <h2>Deployment hardening</h2>
        <p>
          Keep the application private by default, protect local configuration and the data
          directory, and place an authenticating reverse proxy or VPN in front of any
          network-accessible instance.
        </p>
        <p>
          Credentials are read server-side, saved project variables are encrypted at rest, and live
          site checks require domain ownership confirmation. The full model is in the{" "}
          <a href={repoDoc("reference/16-security.md")} target="_blank" rel="noreferrer">
            security reference
          </a>
          .
        </p>
      </section>
    </Page>
  );
}
