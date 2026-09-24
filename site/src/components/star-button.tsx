import { formatStars } from "../lib/github-stars";
import { REPO_URL } from "../lib/site";
import { useRepoStars } from "../lib/use-repo-stars";

/**
 * "Star on GitHub" call to action with the repository's star count.
 *
 * The count is fetched in the visitor's browser and can fail, so the button is a working link
 * first and a counter second: with no confirmed number it renders as a plain call to action. A
 * confirmed zero is left off for the same reason a storefront does not advertise an empty
 * window — the number appears as soon as there is one to show.
 */
export function StarButton({
  size = "regular",
  label = "Star",
  name = "Star LaunchReadyy Community on GitHub",
}: {
  size?: "regular" | "compact";
  /** Visible text. */
  label?: string;
  /** Accessible name. Separate from `label` so varying the visible wording cannot produce a name
   *  that repeats itself, and so the count is read as a plain number rather than a compact one. */
  name?: string;
}) {
  const stars = useRepoStars();
  const showCount = typeof stars === "number" && stars > 0;

  return (
    <a
      className={size === "compact" ? "star-button compact" : "star-button"}
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={showCount ? `${name} — ${stars} stars` : name}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
      </svg>
      <span>{label}</span>
      {showCount ? (
        <span className="star-count" aria-hidden="true">
          {formatStars(stars)}
        </span>
      ) : null}
    </a>
  );
}
