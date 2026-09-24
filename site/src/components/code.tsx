import { useEffect, useRef, useState } from "react";

/**
 * A command block with a copy control.
 *
 * Every install step on this site is something a reader will paste into a terminal, so the block
 * owns the copying rather than relying on text selection. Clipboard failures are swallowed on
 * purpose: the command stays visible and selectable, and a broken clipboard should not surface as
 * an error dialog on a static marketing page.
 */
export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = () => {
    void navigator.clipboard
      ?.writeText(code)
      .then(() => {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  };

  return (
    <div className="code-block">
      {label ? <div className="code-label">{label}</div> : null}
      <pre>
        <code>{code}</code>
      </pre>
      <button type="button" className="code-copy" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
