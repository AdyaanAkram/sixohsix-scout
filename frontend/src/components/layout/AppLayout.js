import { useEffect, useState } from "react";
import { NavLink, useLocation, Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import {
  LayoutDashboard, CalendarDays, Users, ClipboardList, BarChart3, TrendingUp,
  UserCog, FileSpreadsheet, Settings, LogOut, Home, ClipboardCheck,
  MoreHorizontal, ScrollText, ShieldCheck, IdCard, CalendarRange, Bell, Dumbbell,
  ChevronsUpDown, Building2, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NAV_BY_ROLE = {
  owner: ["dashboard", "programs", "events", "players", "review", "reports", "development", "staff", "templates", "drills", "audit", "settings"],
  admin: ["dashboard", "programs", "events", "players", "review", "reports", "development", "staff", "templates", "drills", "audit", "settings"],
  head_scout: ["dashboard", "programs", "events", "players", "review", "reports", "development", "settings"],
  coach: ["dashboard", "programs", "events", "players", "development", "reports", "settings"],
  evaluator: ["dashboard", "events", "evaluate", "my-evaluations", "settings"],
  athlete: ["my-id", "settings"],
  parent: ["my-id", "settings"],
};

const NAV_ITEMS = {
  dashboard: { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  programs: { to: "/programs", label: "Programs", icon: CalendarRange }, // long-term
  events: { to: "/events", label: "Events", icon: CalendarDays }, // short-term camps/clinics
  players: { to: "/players", label: "Players", icon: Users },
  evaluate: { to: "/evaluate", label: "Evaluate", icon: ClipboardCheck },
  "my-evaluations": { to: "/my-evaluations", label: "My Evaluations", icon: ClipboardList },
  review: { to: "/review", label: "Evaluations", icon: ClipboardList },
  reports: { to: "/reports", label: "Reports", icon: BarChart3 },
  development: { to: "/development", label: "Development", icon: TrendingUp },
  staff: { to: "/staff", label: "Staff", icon: UserCog },
  templates: { to: "/templates", label: "Templates", icon: FileSpreadsheet },
  drills: { to: "/drills", label: "Drills", icon: Dumbbell },
  audit: { to: "/audit-log", label: "Audit Log", icon: ScrollText },
  settings: { to: "/settings", label: "Settings", icon: Settings },
  "my-id": { to: "/my-id", label: "My ID", icon: IdCard },
};

const ROLE_LABELS = {
  owner: "Organization Owner", admin: "Administrator", head_scout: "Head Scout",
  coach: "Coach", evaluator: "Evaluator", athlete: "Athlete", parent: "Guardian",
};

const Logo = ({ compact, orgName }) => (
  <div className="flex items-center gap-2.5">
    <div className="h-9 w-9 rounded-xl bg-brand-tertiary flex items-center justify-center ring-1 ring-brand/40">
      <ShieldCheck className="h-5 w-5 text-brand" />
    </div>
    {!compact && (
      <div className="leading-none">
        <p className="font-display text-xl text-foreground">60&apos;6&quot;</p>
        <p className="text-[10px] text-muted-foreground tracking-wide uppercase truncate max-w-[140px]">
          {orgName || "Athletics Scout"}
        </p>
      </div>
    )}
  </div>
);

const SidebarLink = ({ item, onClick }) => {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === "/dashboard" || item.to === "/my-id"}
      onClick={onClick}
      data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150",
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
        )
      }
    >
      <Icon className="h-[18px] w-[18px]" />
      {item.label}
    </NavLink>
  );
};

const MOBILE_PRIMARY = {
  owner: ["dashboard", "programs", "players", "review"],
  admin: ["dashboard", "programs", "players", "review"],
  head_scout: ["dashboard", "programs", "players", "review"],
  coach: ["dashboard", "programs", "players", "development"],
  evaluator: ["dashboard", "events", "evaluate", "my-evaluations"],
  athlete: ["my-id", "settings"],
  parent: ["my-id", "settings"],
};

const MOBILE_LABELS = {
  dashboard: "Home", programs: "Programs", events: "Events", players: "Players", review: "Evaluate",
  evaluate: "Evaluate", development: "Develop", "my-evaluations": "My Evals",
  "my-id": "My ID", settings: "Settings",
};
const MOBILE_ICONS = {
  dashboard: Home, programs: CalendarRange, events: CalendarDays, players: Users, review: ClipboardList,
  evaluate: ClipboardCheck, development: TrendingUp, "my-evaluations": ClipboardList,
  "my-id": IdCard, settings: Settings,
};

const STAFF_ONLY_PREFIXES = [
  "/players", "/evaluate", "/evaluation", "/events", "/review", "/reports",
  "/staff", "/templates", "/drills", "/audit-log", "/development", "/my-evaluations", "/programs",
];

const OrgSwitcher = ({ compact }) => {
  const { user, switchOrganization } = useAuth();
  const [orgs, setOrgs] = useState(user?.memberships || []);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/auth/memberships")
      .then((r) => setOrgs(r.data || []))
      .catch(() => setOrgs(user?.memberships || []));
  }, [user?.organization_id, user?.memberships]);

  const multi = (orgs || []).length > 1;
  if (!user) return null;

  if (!multi) {
    return (
      <div className={cn("px-3 py-2 rounded-xl bg-secondary/60 border border-border", compact && "py-1.5")}>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
          <Building2 className="h-3 w-3" /> Organization
        </p>
        <p className="text-sm font-semibold text-foreground truncate" data-testid="current-org-name">
          {user.organization_name || "—"}
        </p>
      </div>
    );
  }

  const onSwitch = async (orgId) => {
    if (orgId === user.organization_id || busy) return;
    setBusy(true);
    try {
      await switchOrganization(orgId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          data-testid="org-switcher-button"
          className={cn(
            "w-full flex items-center gap-2 rounded-xl border border-border bg-secondary/60 px-3 py-2 text-left hover:bg-secondary transition",
            compact && "w-auto max-w-[180px]"
          )}
        >
          <Building2 className="h-4 w-4 text-brand shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Organization</p>
            <p className="text-sm font-semibold text-foreground truncate">{user.organization_name}</p>
          </div>
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Switch organization</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {orgs.map((o) => (
          <DropdownMenuItem
            key={o.organization_id}
            data-testid={`org-switch-${o.organization_id}`}
            onClick={() => onSwitch(o.organization_id)}
            className="flex items-start gap-2 cursor-pointer"
          >
            <Check className={cn("h-4 w-4 mt-0.5", (o.is_current || o.active || o.organization_id === user.organization_id) ? "opacity-100 text-brand" : "opacity-0")} />
            <div className="min-w-0">
              <p className="font-semibold truncate">{o.organization_name}</p>
              <p className="text-[11px] text-muted-foreground capitalize">
                {o.role?.replace("_", " ")}
                {typeof o.athlete_count === "number" && ` · ${o.athlete_count} athletes`}
                {typeof o.event_count === "number" && ` · ${o.event_count} events`}
              </p>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const AppLayout = ({ children }) => {
  const { user, logout } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState([]);
  const [unread, setUnread] = useState(0);
  const location = useLocation();
  const role = user?.role || "evaluator";
  const navKeys = NAV_BY_ROLE[role] || NAV_BY_ROLE.evaluator;
  const mobileKeys = MOBILE_PRIMARY[role] || MOBILE_PRIMARY.evaluator;
  const moreKeys = navKeys.filter((k) => !mobileKeys.includes(k));
  // Full-screen scoring — hide chrome so metrics get the viewport
  const focusMode = location.pathname.startsWith("/evaluation/");

  const loadNotifs = () => {
    api.get("/notifications/unread-count").then((r) => setUnread(r.data.count || 0)).catch(() => {});
  };
  useEffect(() => {
    loadNotifs();
    const t = setInterval(loadNotifs, 60000);
    return () => clearInterval(t);
  }, []);

  const openNotifs = async () => {
    setNotifOpen(true);
    try {
      const r = await api.get("/notifications");
      setNotifs(r.data || []);
      await api.post("/notifications/read", {});
      setUnread(0);
    } catch { /* ignore */ }
  };

  // Athlete/parent route guard (client) — server also rejects
  if (role === "athlete" || role === "parent") {
    const path = location.pathname;
    const blocked = STAFF_ONLY_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
    if (blocked || path === "/" || path === "/dashboard") {
      return <Navigate to="/my-id" replace />;
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar ≥768px */}
      <aside className={cn("hidden md:flex fixed inset-y-0 left-0 w-[268px] flex-col border-r border-border bg-surface-2 z-40", focusMode && "md:hidden")} data-testid="desktop-sidebar-nav">
        <div className="px-5 py-5 border-b border-divider space-y-3">
          <Logo orgName={user?.organization_name} />
          <OrgSwitcher />
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navKeys.map((k) => (
            <SidebarLink key={k} item={NAV_ITEMS[k]} />
          ))}
        </nav>
        <div className="border-t border-divider px-4 py-4 space-y-2">
          <Button variant="ghost" className="w-full justify-start gap-2 relative" onClick={openNotifs} data-testid="sidebar-notifications-button">
            <Bell className="h-4 w-4" /> Notifications
            {unread > 0 && <span className="ml-auto text-[10px] font-bold bg-brand text-white rounded-full px-1.5">{unread}</span>}
          </Button>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate" data-testid="sidebar-user-name">{user?.full_name}</p>
              <p className="text-xs text-muted-foreground">{ROLE_LABELS[role]}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={logout} data-testid="logout-button" title="Sign out">
              <LogOut className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        </div>
      </aside>

      <Sheet open={notifOpen} onOpenChange={setNotifOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md bg-surface-2 border-border">
          <p className="font-display text-2xl text-foreground mb-4">Notifications</p>
          <div className="space-y-2 max-h-[80vh] overflow-y-auto">
            {notifs.length === 0 ? (
              <p className="text-sm text-muted-foreground">You&apos;re all caught up.</p>
            ) : (
              notifs.map((n) => (
                <div key={n.id} className={cn("rounded-xl border border-border px-3 py-2.5", !n.read && "bg-secondary/50")}>
                  <p className="text-sm font-semibold text-foreground">{n.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{(n.created_at || "").slice(0, 16).replace("T", " ")}</p>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Mobile top bar — glass (hidden in evaluation focus mode) */}
      {!focusMode && (
        <header className="md:hidden sticky top-0 z-40 glass-bar border-b">
          <div className="flex items-center justify-between px-4 h-14 gap-2">
            <div className="min-w-0 flex-1">
              <OrgSwitcher compact />
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="icon" onClick={openNotifs} data-testid="mobile-notifications-button" className="relative">
                <Bell className="h-4 w-4 text-muted-foreground" />
                {unread > 0 && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-brand" />}
              </Button>
              <span className="text-xs text-muted-foreground mr-1">{ROLE_LABELS[role]}</span>
              <Button variant="ghost" size="icon" onClick={logout} data-testid="mobile-logout-button">
                <LogOut className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          </div>
        </header>
      )}

      <main className={cn(!focusMode && "md:pl-[268px]")}>
        {/* pt-* only — py-* would override bottom-nav clearance */}
        <div
          className={cn(
            "mx-auto max-w-[1200px] px-4 sm:px-6 pt-5 sm:pt-7",
            focusMode
              ? "pb-6 max-w-2xl"
              : "pb-safe-nav md:pb-10"
          )}
        >
          {children}
        </div>
      </main>

      {/* Mobile bottom tabs — hidden while scoring so form footer isn't stacked */}
      {!focusMode && (
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t glass-bar"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        data-testid="mobile-bottom-nav"
      >
        <div className={cn("grid", mobileKeys.length + (moreKeys.length ? 1 : 0) <= 5 ? `grid-cols-${Math.min(5, mobileKeys.length + (moreKeys.length ? 1 : 0))}` : "grid-cols-5")}
          style={{ gridTemplateColumns: `repeat(${Math.min(5, mobileKeys.length + (moreKeys.length ? 1 : 0))}, minmax(0, 1fr))` }}
        >
          {mobileKeys.map((k) => {
            const item = NAV_ITEMS[k];
            const Icon = MOBILE_ICONS[k] || item.icon;
            const active = item.to === "/dashboard" || item.to === "/my-id"
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={k}
                to={item.to}
                data-testid={`mobile-bottom-nav-${(MOBILE_LABELS[k] || item.label).toLowerCase().replace(/\s+/g, "-")}`}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 py-2.5 min-h-[60px] text-[11px] font-medium transition-colors",
                  active ? "text-brand" : "text-muted-foreground"
                )}
              >
                <Icon className={cn("h-5 w-5", active && "stroke-[2.4]")} />
                {MOBILE_LABELS[k] || item.label}
              </NavLink>
            );
          })}
          {moreKeys.length > 0 && (
            <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
              <SheetTrigger asChild>
                <button
                  data-testid="mobile-bottom-nav-more"
                  className="flex flex-col items-center justify-center gap-0.5 py-2.5 min-h-[60px] text-[11px] font-medium text-muted-foreground"
                >
                  <MoreHorizontal className="h-5 w-5" />
                  More
                </button>
              </SheetTrigger>
              <SheetContent side="bottom" className="rounded-t-2xl pb-8 bg-surface-2 border-border">
                <p className="font-display text-2xl text-foreground mb-3">More</p>
                <div className="grid grid-cols-2 gap-2">
                  {moreKeys.map((k) => {
                    const item = NAV_ITEMS[k];
                    const Icon = item.icon;
                    return (
                      <NavLink
                        key={k}
                        to={item.to}
                        onClick={() => setMoreOpen(false)}
                        data-testid={`more-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                        className="flex items-center gap-3 rounded-xl border border-border bg-surface-3 px-4 py-3.5 text-sm font-medium text-foreground active:scale-[0.98] transition"
                      >
                        <Icon className="h-5 w-5 text-brand" />
                        {item.label}
                      </NavLink>
                    );
                  })}
                </div>
              </SheetContent>
            </Sheet>
          )}
        </div>
      </nav>
      )}
    </div>
  );
};
