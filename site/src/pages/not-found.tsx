import { Link } from "../components/link";

export function NotFound() {
  return (
    <div className="not-found">
      <div className="score-ring">
        <span>404</span>
      </div>
      <div className="kicker">Route check failed</div>
      <h1>This page never shipped.</h1>
      <p>The path does not exist on the LaunchReadyy public site.</p>
      <Link href="/" className="button primary">
        Return home <span>→</span>
      </Link>
    </div>
  );
}
