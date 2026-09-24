import { createFileRoute } from "@tanstack/react-router";
import { REPO_URL } from "@/lib/product";

export const Route = createFileRoute("/license")({
  component: LicensePage,
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function LicensePage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-bold text-foreground">License</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        LaunchReadyy Community is open-source software licensed under Apache License 2.0. The
        license permits use, modification, and distribution subject to its notice requirements. The
        exact text controls — see the{" "}
        <a href={`${REPO_URL}/blob/main/LICENSE`} className="underline underline-offset-2">
          LICENSE
        </a>{" "}
        file in the repository. Attribution and trademark notices live in the{" "}
        <a href={`${REPO_URL}/blob/main/NOTICE`} className="underline underline-offset-2">
          NOTICE
        </a>{" "}
        and{" "}
        <a href={`${REPO_URL}/blob/main/TRADEMARKS.md`} className="underline underline-offset-2">
          TRADEMARKS.md
        </a>{" "}
        files.
      </p>

      <Section title="What you can do">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Use LaunchReadyy Community for personal, organizational, research, or commercial work.
          </li>
          <li>Self-host it on your own machines and inspect or modify the source.</li>
          <li>Contribute improvements back to the project.</li>
        </ul>
      </Section>

      <Section title="Conditions">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Include a copy of the Apache-2.0 license when distributing the software.</li>
          <li>Mark files you modify when distributing a modified version.</li>
          <li>Retain applicable copyright, patent, trademark, and attribution notices.</li>
          <li>Don't present a fork as the official LaunchReadyy project (see TRADEMARKS.md).</li>
        </ul>
        <p>
          The license does not restrict who may run the software, including as a hosted service. It
          also grants no rights to the LaunchReadyy name or logos — see TRADEMARKS.md for what those
          cover.
        </p>
      </Section>

      <Section title="Questions">
        <p>
          Licensing questions are welcome on the repository's issue tracker at{" "}
          <a href={`${REPO_URL}/issues`} className="underline underline-offset-2">
            {REPO_URL}/issues
          </a>
          .
        </p>
      </Section>
    </div>
  );
}
