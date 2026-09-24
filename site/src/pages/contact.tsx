import { Page } from "../components/page";
import { EMAIL, REPO_URL } from "../lib/site";

export function Contact() {
  return (
    <Page
      eyebrow="Contact"
      title="Talk to the project."
      intro="Email reaches the maintainers directly. Use private GitHub advisories for anything security-related."
    >
      <section className="contact-card">
        <h2>General questions</h2>
        <a className="contact-link" href={`mailto:${EMAIL}`}>
          {EMAIL} <span>↗</span>
        </a>
        <p>Questions about the project, self-hosting, or trademark use.</p>
      </section>
      <section className="contact-card">
        <h2>Issues and contributions</h2>
        <a className="contact-link" href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">
          GitHub issues <span>↗</span>
        </a>
        <p>Bug reports, feature discussions, and public project work.</p>
      </section>
    </Page>
  );
}
