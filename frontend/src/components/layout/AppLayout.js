import { useEffect, useState } from "react";
import { NavLink, useLocation, Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import {
  LayoutDashboard, CalendarDays, Users, ClipboardList, BarChart3, TrendingUp,
  UserCog, FileSpreadsheet, Settings, LogOut, Home, ClipboardCheck,
  MoreHorizontal, ScrollText, IdCard, CalendarRange, Bell, Dumbbell,
  ChevronsUpDown, Building2, Check, Crosshair,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Primary nav keys by role (order = display order). Admin keys listed separately. */
// Primary nav follows the §20 list: Dashboard, Players, Evaluations, Events,
// Progress, Scout, Reports. Programs lives under Administration (it is deferred
// scope per §24, not a day-to-day tab).
const NAV_BY_ROLE = {
  owner: ["dashboard", "players", "review", "events", "development", "scout", "reports"],
  admin: ["dashboard", "players", "review", "events", "development", "scout", "reports"],
  head_scout: ["dashboard", "players", "review", "events", "development", "scout", "reports"],
  coach: ["dashboard", "players", "events", "development", "reports"],
  evaluator: ["dashboard", "events", "evaluate", "my-evaluations"],
  athlete: ["my-id", "settings"],
  parent: ["my-id", "settings"],
};

const ADMIN_BY_ROLE = {
  owner: ["programs", "staff", "templates", "drills", "audit", "settings"],
  admin: ["programs", "staff", "templates", "drills", "audit", "settings"],
  head_scout: ["programs", "settings"],
  coach: ["programs", "settings"],
  evaluator: ["settings"],
  athlete: [],
  parent: [],
};

const NAV_ITEMS = {
  dashboard: { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  programs: { to: "/programs", label: "Programs", icon: CalendarRange },
  events: { to: "/events", label: "Events", icon: CalendarDays },
  players: { to: "/players", label: "Players", icon: Users },
  evaluate: { to: "/evaluate", label: "Evaluate", icon: ClipboardCheck },
  "my-evaluations": { to: "/my-evaluations", label: "My Evaluations", icon: ClipboardList },
  review: { to: "/review", label: "Evaluations", icon: ClipboardList },
  scout: { to: "/scout", label: "Scout", icon: Crosshair },
  reports: { to: "/reports", label: "Reports", icon: BarChart3 },
  development: { to: "/development", label: "Progress", icon: TrendingUp },
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

const Logo = ({ compact }) => (
  <div className="flex items-center gap-2.5">
    <div className="h-9 w-9 rounded-xl bg-brand-tertiary flex items-center justify-center ring-1 ring-brand/50">
      <span className="font-display text-[11px] font-extrabold text-brand leading-none">60</span>
    </div>
    {!compact && (
      <div className="leading-none min-w-0">
        <p className="font-display text-xl text-foreground">60&apos;6&quot; ID</p>
        <p className="text-[10px] text-muted-foreground tracking-wide uppercase truncate">
          Athletics
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
  owner: ["dashboard", "players", "review", "events"],
  admin: ["dashboard", "players", "review", "events"],
  head_scout: ["dashboard", "players", "review", "events"],
  coach: ["dashboard", "players", "events", "development"],
  evaluator: ["dashboard", "events", "evaluate", "my-evaluations"],
  athlete: ["my-id", "settings"],
  parent: ["my-id", "settings"],
};

const MOBILE_LABELS = {
  dashboard: "Home", programs: "Programs", events: "Events", players: "Players", review: "Evals",
  evaluate: "Evaluate", development: "Progress", scout: "Scout", "my-evaluations": "My Evals",
  "my-id": "My ID", settings: "Settings", reports: "Reports",
};
const MOBILE_ICONS = {
  dashboard: Home, programs: CalendarRange, events: CalendarDays, players: Users, review: ClipboardList,
  evaluate: ClipboardCheck, development: TrendingUp, scout: Crosshair, "my-evaluations": ClipboardList,
  "my-id": IdCard, settings: Settings, reports: BarChart3,
};

const STAFF_ONLY_PREFIXES = [
  "/players", "/evaluate", "/evaluation", "/events", "/review", "/reports", "/scout",
  "/staff", "/templates", "/drills", "/audit-log", "/development", "/my-evaluations", "/programs",
];

/** Org identity mark: logo when the payload carries one, styled initial block otherwise. */
const OrgMark = ({ name, logoUrl, className }) => {
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => { setImgFailed(false); }, [logoUrl]);
  if (logoUrl && !imgFailed) {
    return (
      <img
        src={logoUrl}
        alt=""
        onError={() => setImgFailed(true)}
        className={cn("h-8 w-8 rounded-lg object-cover ring-1 ring-border shrink-0", className)}
      />
    );
  }
  return (
    <div className={cn("h-8 w-8 rounded-lg bg-brand-tertiary ring-1 ring-brand/40 flex items-center justify-center shrink-0", className)}>
      {name ? (
        <span className="font-display text-xs font-extrabold text-brand leading-none">{name.charAt(0).toUpperCase()}</span>
      ) : (
        <Building2 className="h-4 w-4 text-brand" />
      )}
    </div>
  );
};

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

  // logo_url may arrive on the user payload or the current membership — render defensively.
  const current = (orgs || []).find((o) => o.organization_id === user.organization_id);
  const logoUrl = user.organization_logo_url || user.organization?.logo_url
    || current?.logo_url || current?.organization_logo_url || null;

  if (!multi) {
    return (
      <div className={cn("flex items-center gap-2.5 px-3 py-2 rounded-xl bg-secondary/60 border border-border", compact && "py-1.5")}>
        <OrgMark name={user.organization_name} logoUrl={logoUrl} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate" data-testid="current-org-name">
            {user.organization_name || "—"}
          </p>
          <p className="text-[9px] uppercase tracking-widest text-muted-foreground truncate">
            Powered by 60&apos;6&quot; ID
          </p>
        </div>
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
          <OrgMark name={user.organization_name} logoUrl={logoUrl} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground truncate">{user.organization_name}</p>
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground truncate">Powered by 60&apos;6&quot; ID</p>
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
  const adminKeys = ADMIN_BY_ROLE[role] || [];
  const mobileKeys = MOBILE_PRIMARY[role] || MOBILE_PRIMARY.evaluator;
  const moreKeys = [...navKeys, ...adminKeys].filter((k) => !mobileKeys.includes(k));
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

  if (role === "athlete" || role === "parent") {
    const path = location.pathname;
    const blocked = STAFF_ONLY_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
    if (blocked || path === "/" || path === "/dashboard") {
      return <Navigate to="/my-id" replace />;
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <aside className={cn("hidden md:flex fixed inset-y-0 left-0 w-[268px] flex-col border-r border-border bg-surface-2 z-40", focusMode && "md:hidden")} data-testid="desktop-sidebar-nav">
        <div className="px-5 py-5 border-b border-divider space-y-3">
          <Logo />
          <OrgSwitcher />
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navKeys.map((k) => (
            <SidebarLink key={k} item={NAV_ITEMS[k]} />
          ))}
          {adminKeys.length > 0 && (
            <>
              <p className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Administration</p>
              {adminKeys.map((k) => (
                <SidebarLink key={k} item={NAV_ITEMS[k]} />
              ))}
            </>
          )}
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

      {!focusMode && (
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t glass-bar"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        data-testid="mobile-bottom-nav"
      >
        <div
          style={{ gridTemplateColumns: `repeat(${Math.min(5, mobileKeys.length + (moreKeys.length ? 1 : 0))}, minmax(0, 1fr))` }}
          className="grid"
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
