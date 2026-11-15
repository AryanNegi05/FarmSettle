import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { homeFor } from "./nav";

export default function NotFound() {
  const { user } = useAuth();
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-4 px-6 text-center">
      <div className="text-6xl">🔍</div>
      <h1 className="text-2xl font-bold text-ink">404 — Page Not Found</h1>
      <p className="text-ink-muted">The page you're looking for doesn't exist.</p>
      <Link to={user ? homeFor(user.role) : "/"} className="mt-2 px-6 py-2 bg-accent text-white rounded-full hover:bg-accent-dark transition">
        {user ? "Go to my dashboard" : "Go Home"}
      </Link>
    </div>
  );
}
