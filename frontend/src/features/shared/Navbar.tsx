import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { homeFor, navFor } from "./nav";
import { useI18n } from "../../i18n";
import LanguageSwitcher from "./LanguageSwitcher";

const FARMER_NAV: Record<string, string> = {
  "/farmer": "nav.dashboard", "/farmer/farms": "nav.farms", "/farmer/claims": "nav.claims", "/farmer/policy": "nav.policy",
  "/farmer/map": "nav.map", "/farmer/bank": "nav.bank", "/farmer/profile": "nav.profile",
};

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useI18n();
  const items = navFor(user?.role).map((i) => (user?.role === "farmer" && FARMER_NAV[i.to] ? { ...i, label: t(FARMER_NAV[i.to]) } : i));

  function handleLogout() {
    logout();
    navigate("/");
  }

  return (
    <header className="sticky top-0 z-40 px-3 sm:px-6 pt-3 pb-2 md:h-[80px]">
      <nav className="mx-auto max-w-[1400px] rounded-[2rem] md:rounded-full border border-line/80 bg-surface/75 backdrop-blur-xl shadow-card px-4 sm:px-6 py-2.5 md:py-0 md:h-[60px] md:flex md:items-center">
        <div className="flex items-center justify-between gap-4 w-full">
          <Link to={user ? homeFor(user.role) : "/"} className="flex items-center gap-2.5 shrink-0">
            <span className="grid place-items-center h-9 w-9 rounded-xl bg-ink text-white text-sm font-bold shadow-sm">F</span>
            <span className="text-ink font-extrabold text-xl tracking-tighter">FarmTrust</span>
          </Link>

          {/* Role menu (desktop) */}
          {items.length > 0 && (
            <div className="hidden md:flex items-center gap-0.5 rounded-full bg-sunken/70 border border-line/70 p-1 flex-1 max-w-fit mx-auto">
              {items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.end}
                  className={({ isActive }) => `px-3.5 py-1.5 rounded-full text-[13px] font-semibold whitespace-nowrap transition ${isActive ? "bg-surface text-ink shadow-sm" : "text-ink-soft hover:text-ink"}`}>
                  {i.label}
                </NavLink>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 text-sm shrink-0">
            {user?.role === "farmer" && <LanguageSwitcher />}
            {user ? (
              <>
                <span className="text-ink-muted hidden xl:inline">
                  {user.full_name ?? user.email}
                  <span className="ml-2 px-2 py-0.5 rounded-full bg-accent-soft text-accent text-[10px] font-bold uppercase tracking-widest">{user.role}</span>
                </span>
                <button onClick={handleLogout} className="px-5 py-2 rounded-full bg-ink text-white font-semibold hover:bg-ink-soft transition shadow-sm">Logout</button>
              </>
            ) : (
              <>
                <Link to="/login" className="text-ink-soft font-semibold hover:text-ink transition">Login</Link>
                <Link to="/register" className="px-5 py-2 rounded-full bg-ink text-white font-semibold hover:bg-ink-soft transition shadow-sm">Register</Link>
              </>
            )}
          </div>
        </div>

        {/* Role menu (mobile): scrolls sideways instead of wrapping */}
        {items.length > 0 && (
          <div className="md:hidden mt-2 -mx-1 flex gap-1 overflow-x-auto pb-1">
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end}
                className={({ isActive }) => `whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-semibold transition ${isActive ? "bg-ink text-white" : "text-ink-soft bg-sunken"}`}>
                {i.label}
              </NavLink>
            ))}
          </div>
        )}
      </nav>
    </header>
  );
}
