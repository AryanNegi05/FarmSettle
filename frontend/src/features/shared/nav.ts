import type { UserRole } from "../../api/auth";

/** Each role's home page. */
export function homeFor(role?: UserRole | null): string {
  switch (role) {
    case "farmer": return "/farmer";
    case "insurer": return "/insurer";
    case "auditor": return "/auditor";
    case "admin": return "/admin";
    default: return "/";
  }
}

export interface NavItem { to: string; label: string; end?: boolean }

/** The menu each role sees in the top bar. */
export function navFor(role?: UserRole | null): NavItem[] {
  switch (role) {
    case "farmer":
      return [
        { to: "/farmer", label: "Dashboard", end: true },
        { to: "/farmer/farms", label: "My Farms" },
        { to: "/farmer/claims", label: "Claims" },
        { to: "/farmer/policy", label: "My Policy" },
        { to: "/farmer/map", label: "Farm Map" },
        { to: "/farmer/bank", label: "Bank" },
        { to: "/farmer/profile", label: "Profile" },
      ];
    case "insurer":
    case "admin":
      return [
        { to: "/insurer", label: "Dashboard", end: true },
        { to: "/insurer/farmers", label: "Farmers" },
        { to: "/insurer/policies", label: "Policies" },
        { to: "/insurer/claims", label: "Claims" },
        { to: "/insurer/command", label: "Command Centre" },
        { to: "/insurer/replay", label: "Replay" },
        ...(role === "admin" ? [{ to: "/admin", label: "Admin" }] : []),
      ];
    case "auditor":
      return [
        { to: "/auditor", label: "Dashboard", end: true },
        { to: "/insurer/farmers", label: "Farmers" },
        { to: "/insurer/policies", label: "Policies" },
        { to: "/insurer/claims", label: "Claims" },
        { to: "/insurer/command", label: "Command Centre" },
        { to: "/insurer/basis-risk", label: "Basis Risk" },
        { to: "/insurer/replay", label: "Replay" },
      ];
    default:
      return [];
  }
}

const PREFIXES: Record<UserRole, string[]> = {
  farmer: ["/farmer"],
  insurer: ["/insurer"],
  admin: ["/insurer", "/admin", "/auditor"],
  auditor: ["/auditor", "/insurer/farmers", "/insurer/policies", "/insurer/map", "/insurer/claims", "/insurer/command", "/insurer/basis-risk", "/insurer/replay"],
};

/** True if this role may open the path, so a post-login redirect never lands on "Access Denied". */
export function canVisit(role: UserRole, path: string): boolean {
  const clean = path.split("?")[0];
  if (role === "auditor" && (clean.endsWith("/new") || clean.endsWith("/edit"))) return false;
  return PREFIXES[role].some((p) => clean === p || clean.startsWith(p + "/"));
}
