import { useEffect, useState } from "react";
import { REPO_API, isFresh, readStarsCache, writeStarsCache } from "./github-stars";

/**
 * The repository's star count, or `null` while unknown.
 *
 * A cached answer is served immediately and refetched only after it goes stale, which keeps a
 * page view from spending one of the sixty hourly requests GitHub allows an anonymous client.
 * When the request fails — rate limited, offline, blocked — the last known count is kept rather
 * than flashing a zero, and with no cache at all the caller simply renders no number.
 */
export function useRepoStars(): number | null {
  const [stars, setStars] = useState<number | null>(() => readStarsCache()?.count ?? null);

  useEffect(() => {
    const cached = readStarsCache();
    if (cached && isFresh(cached)) {
      setStars(cached.count);
      return;
    }

    const controller = new AbortController();

    fetch(REPO_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((data: { stargazers_count?: unknown }) => {
        if (typeof data.stargazers_count !== "number") return;
        writeStarsCache(data.stargazers_count);
        setStars(data.stargazers_count);
      })
      .catch(() => {
        if (cached) setStars(cached.count);
      });

    return () => controller.abort();
  }, []);

  return stars;
}
