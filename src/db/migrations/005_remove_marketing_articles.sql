-- The in-app marketing articles behind /blog/$slug are gone: the landing site under `site/` owns that
-- content now, and /changelog is a static list. Nothing reads this table any more.
DROP TABLE IF EXISTS marketing_articles;
