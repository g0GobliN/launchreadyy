/** Bump when replacing files in public/marketing/ so browsers drop stale assets. */
export const MKT = "v5";

function mkt(path: string) {
  return `/marketing/${path}?${MKT}`;
}

export const homeAssets = {
  heroPoster: mkt("gen-hero-poster.jpg"),
  heroWebm: mkt("hero-loop.webm"),
  heroMp4: mkt("hero-loop.mp4"),
  sandbox: mkt("gen-sandbox.jpg"),
  score: mkt("gen-score.jpg"),
  pr: mkt("gen-pr.jpg"),
  integrateConnect: mkt("gen-integrate-connect.jpg"),
  integratePr: mkt("gen-integrate-pr.jpg"),
};
