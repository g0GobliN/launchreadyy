/**
 * Chrome (and others) clip print output to one page when the app shell uses
 * fixed viewport height + overflow:hidden (h-svh). Before print, move the
 * report to be a direct child of <body> so pagination sees full document height.
 */
export function installLaunchReportPrintLift(reportEl: HTMLElement): () => void {
  let placeholder: Comment | null = null;
  let parent: Node | null = null;
  let next: Node | null = null;
  let active = false;

  const onBefore = () => {
    if (active) return;
    active = true;
    parent = reportEl.parentNode;
    next = reportEl.nextSibling;
    placeholder = document.createComment("launch-report-print");
    parent?.insertBefore(placeholder, reportEl);
    document.body.appendChild(reportEl);
    document.body.classList.add("is-printing-launch-report");
  };

  const onAfter = () => {
    if (!active) return;
    active = false;
    document.body.classList.remove("is-printing-launch-report");
    if (placeholder?.parentNode) {
      placeholder.parentNode.insertBefore(reportEl, placeholder);
      placeholder.remove();
    } else if (parent) {
      parent.insertBefore(reportEl, next);
    }
    placeholder = null;
    parent = null;
    next = null;
  };

  const onMql = (e: MediaQueryListEvent) => {
    if (e.matches) onBefore();
    else onAfter();
  };

  window.addEventListener("beforeprint", onBefore);
  window.addEventListener("afterprint", onAfter);
  const mql = window.matchMedia("print");
  mql.addEventListener("change", onMql);

  return () => {
    window.removeEventListener("beforeprint", onBefore);
    window.removeEventListener("afterprint", onAfter);
    mql.removeEventListener("change", onMql);
    if (active) onAfter();
  };
}
