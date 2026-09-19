export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Something broke — LaunchReadyy</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        --bg: #14151b;
        --bg: oklch(0.16 0.018 265);
        --fg: #f2f3f5;
        --fg: oklch(0.97 0.005 260);
        --muted: #9a9ba6;
        --muted: oklch(0.68 0.025 260);
        --primary: #4fd68a;
        --primary: oklch(0.72 0.18 155);
        --primary-fg: #0d1f14;
        --primary-fg: oklch(0.15 0.02 160);
        --critical: #e5493c;
        --critical: oklch(0.62 0.24 25);
        --surface: #1c1d25;
        --surface: oklch(0.2 0.02 265);
        --border: #34363f;
        --border: oklch(0.28 0.022 265);
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        min-height: 100vh;
        background: var(--bg);
        color: var(--fg);
        font: 15px/1.6 "Manrope", system-ui, -apple-system, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      body {
        position: relative;
        display: grid;
        place-items: center;
        padding: 1.5rem;
        overflow: hidden;
      }
      .grid-bg {
        position: absolute;
        inset: 0;
        background-image:
          linear-gradient(to right, color-mix(in oklab, var(--border) 55%, transparent) 1px, transparent 1px),
          linear-gradient(to bottom, color-mix(in oklab, var(--border) 55%, transparent) 1px, transparent 1px);
        background-size: 44px 44px;
        -webkit-mask-image: radial-gradient(ellipse at center, black 30%, transparent 75%);
        mask-image: radial-gradient(ellipse at center, black 30%, transparent 75%);
        opacity: 0.5;
      }
      .glow {
        position: absolute;
        top: -140px;
        left: 50%;
        transform: translateX(-50%);
        width: 700px;
        height: 420px;
        border-radius: 999px;
        background: color-mix(in oklab, var(--primary) 22%, transparent);
        filter: blur(90px);
        pointer-events: none;
      }
      .card {
        position: relative;
        max-width: 30rem;
        width: 100%;
        text-align: center;
        padding: 1rem;
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 0.7rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--critical);
      }
      .glitch {
        display: inline-block;
        animation: glitch 3.4s infinite;
      }
      @keyframes glitch {
        0%, 92%, 100% { transform: translate(0, 0); opacity: 1; text-shadow: none; }
        93% { transform: translate(-1px, 0.5px); opacity: 0.85; text-shadow: 1px 0 var(--primary); }
        95% { transform: translate(1px, -0.5px); opacity: 0.92; text-shadow: -1px 0 var(--critical); }
        97% { transform: translate(0, 0); opacity: 1; text-shadow: none; }
      }
      h1 {
        font-family: "Manrope", system-ui, sans-serif;
        letter-spacing: -0.02em;
        font-size: clamp(1.75rem, 5vw, 2.5rem);
        margin: 0.75rem 0 0;
        font-weight: 600;
      }
      .gradient {
        background: linear-gradient(135deg, var(--fg), color-mix(in oklab, var(--primary) 70%, var(--fg)));
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }
      .sub {
        margin: 0.9rem 0 0;
        color: var(--muted);
      }
      .terminal {
        margin-top: 1.5rem;
        text-align: left;
        border: 1px solid var(--border);
        background: color-mix(in oklab, var(--surface) 85%, transparent);
        border-radius: 0.5rem;
        padding: 0.75rem 1rem;
        font-family: "JetBrains Mono", ui-monospace, monospace;
        font-size: 0.8rem;
      }
      #roast {
        color: var(--muted);
        transition: opacity 0.2s ease;
      }
      .cursor {
        color: var(--primary);
        animation: blink 1s step-end infinite;
      }
      @keyframes blink { 50% { opacity: 0; } }
      #reroll {
        display: block;
        margin: 0.5rem 0 0;
        padding: 0;
        border: none;
        background: none;
        color: var(--muted);
        font-family: inherit;
        font-size: 0.75rem;
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      #reroll:hover { color: var(--primary); }
      .actions {
        display: flex;
        gap: 0.6rem;
        justify-content: center;
        flex-wrap: wrap;
        margin-top: 1.5rem;
      }
      a, button.action {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.6rem 1.1rem;
        border-radius: 0.5rem;
        font: inherit;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        text-decoration: none;
        border: 1px solid transparent;
        transition: transform 0.15s ease, opacity 0.15s ease, background 0.15s ease;
      }
      a:active, button:active { transform: scale(0.97); }
      .primary {
        background: var(--primary);
        color: var(--primary-fg);
        box-shadow: 0 0 0 1px color-mix(in oklab, var(--primary) 30%, transparent),
          0 8px 30px -8px color-mix(in oklab, var(--primary) 45%, transparent);
      }
      .primary:hover { opacity: 0.92; }
      .secondary {
        background: var(--surface);
        color: var(--fg);
        border-color: var(--border);
      }
      .secondary:hover { background: color-mix(in oklab, var(--surface) 80%, var(--fg) 6%); }
      .retry-note {
        margin-top: 1rem;
        font-size: 0.78rem;
        color: var(--muted);
        font-family: "JetBrains Mono", ui-monospace, monospace;
      }
      .retry-note button {
        padding: 0;
        border: none;
        background: none;
        color: var(--muted);
        text-decoration: underline;
        text-underline-offset: 2px;
        font-size: inherit;
        font-family: inherit;
      }
      footer {
        margin-top: 2.25rem;
        font-size: 0.78rem;
        color: var(--muted);
      }
      footer a { display: inline; padding: 0; color: var(--muted); text-decoration: underline; text-underline-offset: 2px; }
    </style>
  </head>
  <body>
    <div class="grid-bg" aria-hidden="true"></div>
    <div class="glow" aria-hidden="true"></div>
    <div class="card">
      <span class="eyebrow"><span class="glitch">ERROR 500</span></span>
      <h1>Something went <span class="gradient">wrong.</span></h1>
      <p class="sub">Try refreshing or head back home — we'll get it sorted.</p>

      <div class="terminal">
        <span id="status-line"></span><span class="cursor">_</span>
        <button type="button" id="next-line">next →</button>
      </div>

      <div class="actions">
        <button class="action primary" onclick="location.reload()">↻ Try again</button>
        <a class="action secondary" href="/">Go home</a>
      </div>
      <p class="retry-note" id="retry-note"></p>

      <footer>
        Still stuck? <a href="mailto:launchreadyy@gmail.com">launchreadyy@gmail.com</a>
      </footer>
    </div>
    <script>
      (function () {
        var statusLines = [
          "$ status → 500 internal error",
          "$ handler → unhandled exception",
          "$ retry → recommended",
          "$ session → preserved",
          "$ next_action → refresh, or go home",
        ];
        var lineEl = document.getElementById("status-line");
        var current = 0;
        function show(i) {
          lineEl.style.opacity = "0";
          setTimeout(function () {
            current = i;
            lineEl.textContent = statusLines[i];
            lineEl.style.opacity = "1";
          }, 200);
        }
        function showNext() {
          var next = Math.floor(Math.random() * statusLines.length);
          if (statusLines.length > 1 && next === current) next = (next + 1) % statusLines.length;
          show(next);
        }
        show(0);
        document.getElementById("next-line").addEventListener("click", showNext);
        setInterval(showNext, 4500);

        var retryNote = document.getElementById("retry-note");
        var seconds = 12;
        var cancelled = false;
        function tick() {
          if (cancelled) return;
          if (seconds <= 0) {
            location.reload();
            return;
          }
          retryNote.innerHTML =
            "Auto-retrying in " + seconds + "s — <button type='button' id='cancel-retry'>cancel</button>";
          var cancelBtn = document.getElementById("cancel-retry");
          if (cancelBtn) {
            cancelBtn.addEventListener("click", function () {
              cancelled = true;
              retryNote.textContent = "Auto-retry cancelled.";
            });
          }
          seconds--;
          setTimeout(tick, 1000);
        }
        tick();
      })();
    </script>
  </body>
</html>`;
}
