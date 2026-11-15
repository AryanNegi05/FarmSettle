import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { homeFor } from "./nav";

export default function AccessDenied() {
  const { user } = useAuth();
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-4 px-6 text-center">
      <div className="text-6xl">🚫</div>
      <h1 className="text-2xl font-bold text-ink">Access Denied</h1>
      <p className="text-ink-muted">
        {user ? <>You're signed in as <b className="text-ink">{user.role}</b>, and this page is for a different role.</> : "Please sign in to continue."}
      </p>
      <div className="flex gap-3 mt-2">
        {user ? (
          <Link to={homeFor(user.role)} className="px-6 py-2 bg-accent text-white rounded-full hover:bg-accent-dark transition">Go to my dashboard</Link>
        ) : (
          <Link to="/login" className="px-6 py-2 bg-accent text-white rounded-full hover:bg-accent-dark transition">Sign in</Link>
        )}
        <Link to="/" className="px-6 py-2 bg-sunken text-ink rounded-lg hover:bg-line transition">Home</Link>
      </div>
    </div>
  );
}
