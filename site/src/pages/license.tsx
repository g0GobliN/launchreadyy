import { Page } from "../components/page";
import { repoFile } from "../lib/site";

export function License() {
  return (
    <Page
      eyebrow="License"
      title="Apache-2.0, with a separate brand policy."
      intro="LaunchReadyy Community is open-source software. The license governs the code; the trademark policy governs the project name, the logos, and nothing else."
    >
      <section>
        <h2>Software license</h2>
        <p>
          The repository's <a href={repoFile("LICENSE")}>LICENSE</a> file is the source of truth. It
          includes the permissions, conditions, patent grant, patent-termination clause, warranty
          disclaimer, and limitation of liability that apply to the software.
        </p>
      </section>
      <section>
        <h2>What the license permits</h2>
        <p>
          You may self-host Community on your own infrastructure, use it for personal, research,
          internal, or commercial work, modify it, redistribute it, and run it as a hosted service,
          including a commercial one.
        </p>
        <p>
          Redistribution carries conditions: ship the license text, mark files you modified, and
          retain the attribution notices.
        </p>
      </section>
      <section>
        <h2>Attribution and notices</h2>
        <p>
          The <a href={repoFile("NOTICE")}>NOTICE</a> file carries the project attribution and
          states explicitly that the license grants no trademark rights. It is distributed alongside
          the code; preserved notices are what allow downstream users to trace the project.
        </p>
      </section>
      <section>
        <h2>Trademarks</h2>
        <p>
          The software license does not grant permission to present an unofficial fork, modified
          version, product, or service as the official LaunchReadyy project. Read the{" "}
          <a href={repoFile("TRADEMARKS.md")}>trademark guidance</a> before distributing a fork.
        </p>
        <p>
          The license places no limit on who may run the software, including as a hosted service.
          Trademark use is the only thing it restricts, and forks are always free to ship under
          their own name.
        </p>
      </section>
    </Page>
  );
}
