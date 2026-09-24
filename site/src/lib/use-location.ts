import { useEffect, useState } from "react";

export type Location = { path: string; hash: string };

function read(): Location {
  return {
    path: window.location.pathname.replace(/\/+$/, "") || "/",
    hash: window.location.hash.replace(/^#/, ""),
  };
}

/**
 * Current path and hash.
 *
 * The hash is tracked alongside the path because `/docs#configuration` must move the reader to a
 * section when the route is unchanged. Watching only the pathname would make in-page anchors a
 * no-op after the first visit.
 */
export function useLocation(): Location {
  const [location, setLocation] = useState<Location>(read);

  useEffect(() => {
    const update = () => setLocation(read());
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("hashchange", update);
    };
  }, []);

  return location;
}
