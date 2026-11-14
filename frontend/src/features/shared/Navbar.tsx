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
    <nav className="bg-navy-800 border-b border-navy-700 px-4 sm:px-6 py-2.5 md:py-0 md:h-[57px] md:flex md:items-center">
      <div className="flex items-center justify-between gap-4 w-full">
        <Link to={user ? homeFor(user.role) : "/"} className="flex items-center gap-2 shrink-0">
          <span className="text-brand-green font-bold text-xl tracking-tight">Para</span>
          <span className="text-white font-bold text-xl">Trust</span>
        </Link>

        {/* Role menu (desktop) */}
        {items.length > 0 && (
          <div className="hidden md:flex items-center gap-1 flex-1 justify-center">
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end}
                className={({ isActive }) => `px-3 py-1.5 rounded-lg text-sm transition ${isActive ? "bg-brand-blue/20 text-white font-semibold" : "text-gray-300 hover:text-white hover:bg-navy-700"}`}>
                {i.label}
              </NavLink>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 text-sm shrink-0">
          {user?.role === "farmer" && <LanguageSwitcher />}
          {user ? (
            <>
              <span className="text-gray-400 hidden sm:inline">
                {user.full_name ?? user.email}
                <span className="ml-2 px-2 py-0.5 rounded-full bg-brand-blue/20 text-brand-blue text-xs uppercase tracking-wide">{user.role}</span>
              </span>
              <button onClick={handleLogout} className="px-4 py-1.5 rounded-lg bg-navy-700 hover:bg-navy-600 text-white transition">Logout</button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-gray-300 hover:text-white transition">Login</Link>
              <Link to="/register" className="px-4 py-1.5 rounded-lg bg-brand-green text-navy font-semibold hover:bg-green-400 transition">Register</Link>
            </>
          )}
        </div>
      </div>

      {/* Role menu (mobile): scrolls sideways instead of wrapping */}
      {items.length > 0 && (
        <div className="md:hidden mt-2 -mx-1 flex gap-1 overflow-x-auto pb-1">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end}
              className={({ isActive }) => `whitespace-nowrap px-3 py-1.5 rounded-lg text-xs transition ${isActive ? "bg-brand-blue/20 text-white font-semibold" : "text-gray-300 bg-navy-700/60"}`}>
              {i.label}
            </NavLink>
          ))}
        </div>
      )}
    </nav>
  );
}
