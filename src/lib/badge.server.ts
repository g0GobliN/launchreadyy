/** Shields-style SVG badge for README embedding. */

export function scoreBadgeColor(score: number): string {
  if (score >= 75) return "#22c55e";
  if (score >= 50) return "#eab308";
  return "#ef4444";
}

export function scoreBadgeSvg(score: number, label = "launch ready"): string {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const color = scoreBadgeColor(clamped);
  const leftLabel = "LaunchReadyy";
  const rightLabel = `${clamped}/100 ${label}`;

  const leftWidth = 108;
  const rightWidth = Math.max(72, rightLabel.length * 7 + 16);
  const total = leftWidth + rightWidth;
  const h = 20;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${h}" role="img" aria-label="${leftLabel}: ${clamped}/100">
  <title>${leftLabel}: ${clamped}/100</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${total}" height="${h}" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${leftWidth}" height="${h}" fill="#555"/>
    <rect x="${leftWidth}" width="${rightWidth}" height="${h}" fill="${color}"/>
    <rect width="${total}" height="${h}" fill="url(#s)"/>
  </g>
  <g fill="#fff" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="${leftWidth / 2}" y="14" text-anchor="middle" fill="#010101" fill-opacity=".3">${leftLabel}</text>
    <text x="${leftWidth / 2}" y="13" text-anchor="middle">${leftLabel}</text>
    <text x="${leftWidth + rightWidth / 2}" y="14" text-anchor="middle" fill="#010101" fill-opacity=".3">${rightLabel}</text>
    <text x="${leftWidth + rightWidth / 2}" y="13" text-anchor="middle">${rightLabel}</text>
  </g>
</svg>`;
}

export function badgeSvgResponse(svg: string): Response {
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
