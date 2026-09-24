/**
 * The `/docs` table of contents, in reading order.
 *
 * Single source of truth for both the sidebar links and the active-section observer. Each `id`
 * must match a `DocsSection` id in `pages/docs.tsx`: a drift here shows up as a sidebar entry that
 * scrolls nowhere, which is why the ids are declared once and imported rather than hand-written
 * twice.
 */
export const DOCS_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "quick-start", label: "Quick start" },
  { id: "requirements", label: "Requirements" },
  { id: "configuration", label: "Configuration" },
  { id: "development", label: "Development" },
  { id: "deployment", label: "Self-hosting" },
  { id: "security", label: "Security model" },
  { id: "operations", label: "Operations" },
  { id: "troubleshooting", label: "Troubleshooting" },
  { id: "next-steps", label: "Where to go next" },
] as const;
