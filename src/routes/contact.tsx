import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Mail, MessageSquare, Github, Clock } from "lucide-react";
import { REPO_URL } from "@/lib/product";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact — LaunchReadyy" },
      { name: "description", content: "Get in touch with the LaunchReadyy team." },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <div className="mx-auto max-w-2xl px-6 py-20">
        <div className="mb-12">
          <h1 className="font-display text-4xl font-bold">Get in touch</h1>
          <p className="text-muted-foreground mt-3 leading-relaxed">
            Have a question, found a bug, or just want to say hi? We'd love to hear from you.
          </p>
        </div>

        <div className="space-y-4">
          <a
            href="mailto:launchreadyy@gmail.com"
            className="flex items-start gap-4 rounded-2xl border border-border bg-card p-6 hover:bg-muted/40 transition-colors group"
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10">
              <Mail className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-semibold group-hover:text-primary transition-colors">Email us</p>
              <p className="text-sm text-muted-foreground mt-0.5">launchreadyy@gmail.com</p>
              <p className="text-xs text-muted-foreground mt-2">
                Best for general questions about the project.
              </p>
            </div>
          </a>

          <a
            href="mailto:launchreadyy@gmail.com?subject=Security Vulnerability Report"
            className="flex items-start gap-4 rounded-2xl border border-border bg-card p-6 hover:bg-muted/40 transition-colors group"
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10">
              <Mail className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-semibold group-hover:text-primary transition-colors">
                Security reports
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">launchreadyy@gmail.com</p>
              <p className="text-xs text-muted-foreground mt-2">
                Responsible disclosure for vulnerabilities in LaunchReadyy itself.
              </p>
            </div>
          </a>

          <a
            href="https://github.com/g0GobliN"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-4 rounded-2xl border border-border bg-card p-6 hover:bg-muted/40 transition-colors group"
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10">
              <Github className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-semibold group-hover:text-primary transition-colors">GitHub</p>
              <p className="text-sm text-muted-foreground mt-0.5">@g0GobliN</p>
              <p className="text-xs text-muted-foreground mt-2">
                Found a bug or want to follow development? Open an issue or follow along.
              </p>
            </div>
          </a>

          <a
            href={`${REPO_URL}/issues`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-4 rounded-2xl border border-border bg-card p-6 hover:bg-muted/40 transition-colors group"
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10">
              <MessageSquare className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-semibold group-hover:text-primary transition-colors">
                Open an issue
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">GitHub issues</p>
              <p className="text-xs text-muted-foreground mt-2">
                Feature requests, bugs, or anything on your mind.
              </p>
            </div>
          </a>

          <div className="flex items-start gap-4 rounded-2xl border border-border/50 bg-muted/20 p-5">
            <Clock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              We typically respond within{" "}
              <span className="text-foreground font-medium">24–48 hours</span>. For vulnerabilities
              in LaunchReadyy itself, email with "Security" in the subject — see also our{" "}
              <Link to="/security" className="text-primary hover:underline">
                security page
              </Link>
              .
            </p>
          </div>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
