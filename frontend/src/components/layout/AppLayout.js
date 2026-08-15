import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api, signedUrl } from "@/lib/api";
import {
  LayoutDashboard, CalendarDays, Users, ClipboardList, BarChart3, TrendingUp,
  UserCog, FileSpreadsheet, Settings, LogOut, Home, ClipboardCheck,
  MoreHorizontal, ScrollText, IdCard, CalendarRange, Bell, Dumbbell,
  ChevronsUpDown, Building2, Check, Crosshair, Shield, Star, ArrowLeftRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** ---------------------------------------------------------------------------
 * Workspace model — a workspace is a LENS over the app, never an access grant.
 * Every route keeps its existing role gates; switching workspaces only changes
 * which nav set / dashboard framing the account sees. One account moves between
 * the modes it is entitled to (client: "workspace/role switcher, not five
 * duplicate applications").
 *   hq        — Organization HQ:   Overview | Teams | Athletes | Development | Events
 *   coach     — Coach Hub:         Overview | My Teams | My Athletes | Evaluations | Development
 *   scout     — Scout Mode (review-first): Overview | Review | Discover | Watchlist | Compare | Events
 *   evaluator — Evaluation Mode:   Today's Event | Evaluate | Submitted
 *   athlete   — My Development
 * ------------------------------------------------------------------------- */
export const WORKSPACES_BY_ROLE = {
  // Athlete View intentionally omitted for staff: no linked athlete profile
  // on staff accounts (already flagged to the client).
  owner: ["hq", "coach", "scout", "evaluator"],
  admin: ["hq", "coach", "scout", "evaluator"],
  head_scout: ["scout"], // scout mode already includes Review
  coach: ["coach", "evaluator"],
  evaluator: ["evaluator"],
  athlete: ["athlete"],
  parent: ["athlete"],
};

export const WORKSPACE_META = {
  hq: { label: "Organization HQ", blurb: "Full administration", icon: Building2 },
  coach: { label: "Coach Hub", blurb: "My teams & athletes", icon: Shield },
  scout: { label: "Scout Mode", blurb: "Discover, watchlist, compare", icon: Crosshair },
  evaluator: { label: "Evaluation Mode", blurb: "Field scoring", icon: ClipboardCheck },
  athlete: { label: "My Development", blurb: "My profile, progress & goals", icon: IdCard },
};

export const WORKSPACE_HOME = {
  hq: "/dashboard",
  coach: "/dashboard",
  scout: "/scout",
  evaluator: "/evaluate",
  athlete: "/my-id",
};

export const getAuthorizedWorkspaces = (role) =>
  WORKSPACES_BY_ROLE[role] || WORKSPACES_BY_ROLE.evaluator;

const workspaceStorageKey = (userId) => `606_workspace_${userId || "anon"}`;

/** True only when a stored choice exists AND it is authorized for the role. */
export const hasStoredWorkspace = (user) => {
  const authorized = getAuthorizedWorkspaces(user?.role);
  let stored = null;
  try { stored = localStorage.getItem(workspaceStorageKey(user?.id)); } catch { /* ignore */ }
  return !!stored && authorized.includes(stored);
};

/** Active workspace = stored choice if authorized, else first authorized. */
export const getActiveWorkspace = (user) => {
  const authorized = getAuthorizedWorkspaces(user?.role);
  let stored = null;
  try { stored = localStorage.getItem(workspaceStorageKey(user?.id)); } catch { /* ignore */ }
  return stored && authorized.includes(stored) ? stored : authorized[0];
};

export const persistWorkspace = (userId, workspace) => {
  try { localStorage.setItem(workspaceStorageKey(userId), workspace); } catch { /* ignore */ }
};

const WorkspaceContext = createContext(null);
/** { workspace, workspaces, switchWorkspace } — null outside AppLayout. */
export const useWorkspace = () => useContext(WorkspaceContext);

/** Primary nav keys by workspace (order = display order). Admin keys listed separately. */
const NAV_BY_WORKSPACE = {
  hq: ["dashboard", "teams", "players", "development", "events"],
  coach: ["dashboard", "my-teams", "my-athletes", "coach-evals", "development"],
  scout: ["dashboard", "hs-review", "discover", "watchlist", "compare", "events"],
  evaluator: ["todays-event", "evaluate", "submitted"],
  athlete: ["my-id", "settings"],
};

const ADMIN_BY_WORKSPACE = {
  hq: ["review", "scout", "reports", "programs", "staff", "templates", "drills", "audit", "settings"],
  coach: ["scout", "reports", "programs", "settings"],
  scout: ["players", "reports", "programs", "settings"],
  evaluator: ["settings"], // owner/coach dropping into evaluator mode keep Settings
  athlete: [],
};

// `slug` overrides the label-derived data-testid suffix so existing testids
// survive relabels (e.g. Progress → Development keeps `nav-progress`).
const NAV_ITEMS = {
  dashboard: { to: "/dashboard", label: "Overview", icon: LayoutDashboard, slug: "dashboard" },
  teams: { to: "/teams", label: "Teams", icon: Shield },
  "my-teams": { to: "/teams", label: "My Teams", icon: Shield, slug: "teams" },
  programs: { to: "/programs", label: "Programs", icon: CalendarRange },
  events: { to: "/events", label: "Events", icon: CalendarDays },
  "todays-event": { to: "/events", label: "Today's Event", icon: CalendarDays, slug: "events" },
  players: { to: "/players", label: "Athletes", icon: Users, slug: "players" },
  "my-athletes": { to: "/players", label: "My Athletes", icon: Users, slug: "players" },
  evaluate: { to: "/evaluate", label: "Evaluate", icon: ClipboardCheck },
  "coach-evals": { to: "/evaluate", label: "Evaluations", icon: ClipboardCheck, slug: "evaluations" },
  "my-evaluations": { to: "/my-evaluations", label: "My Evaluations", icon: ClipboardList },
  submitted: { to: "/my-evaluations", label: "Submitted", icon: ClipboardList, slug: "my-evaluations" },
  review: { to: "/review", label: "Evaluations", icon: ClipboardList },
  "hs-review": { to: "/review", label: "Review", icon: ClipboardList, slug: "evaluations" },
  scout: { to: "/scout", label: "Scout", icon: Crosshair },
  discover: { to: "/scout", label: "Discover", icon: Crosshair, slug: "scout" },
  watchlist: { to: "/scout?tab=watchlist", label: "Watchlist", icon: Star },
  compare: { to: "/scout/compare", label: "Compare", icon: ArrowLeftRight },
  reports: { to: "/reports", label: "Reports", icon: BarChart3 },
  development: { to: "/development", label: "Development", icon: TrendingUp, slug: "progress" },
  staff: { to: "/staff", label: "Staff", icon: UserCog },
  templates: { to: "/templates", label: "Templates", icon: FileSpreadsheet },
  drills: { to: "/drills", label: "Drills", icon: Dumbbell },
  audit: { to: "/audit-log", label: "Audit Log", icon: ScrollText },
  settings: { to: "/settings", label: "Settings", icon: Settings },
  "my-id": { to: "/my-id", label: "My Development", icon: IdCard, slug: "my-id" },
};

const navSlug = (item) => item.slug || item.label.toLowerCase().replace(/\s+/g, "-");

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
      data-testid={`nav-${navSlug(item)}`}
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

const MOBILE_PRIMARY_BY_WORKSPACE = {
  hq: ["dashboard", "teams", "players", "events"],
  coach: ["dashboard", "my-teams", "my-athletes", "development"],
  scout: ["dashboard", "hs-review", "discover", "events"],
  evaluator: ["todays-event", "evaluate", "submitted"],
  athlete: ["my-id", "settings"],
};

const MOBILE_LABELS = {
  dashboard: "Home", programs: "Programs", events: "Events", "todays-event": "Today",
  teams: "Teams", "my-teams": "Teams", players: "Athletes", "my-athletes": "Athletes",
  review: "Evals", "hs-review": "Review", evaluate: "Evaluate", "coach-evals": "Evals",
  development: "Develop", scout: "Scout", discover: "Discover", watchlist: "Watchlist",
  compare: "Compare", "my-evaluations": "My Evals", submitted: "Submitted",
  "my-id": "My ID", settings: "Settings", reports: "Reports",
};
// Testid suffix overrides so relabeled tabs keep their pre-existing testids.
const MOBILE_SLUGS = {
  players: "players", "my-athletes": "players", development: "progress",
  "hs-review": "evals", "todays-event": "events", submitted: "my-evals",
};
const MOBILE_ICONS = {
  dashboard: Home, programs: CalendarRange, events: CalendarDays, "todays-event": CalendarDays,
  teams: Shield, "my-teams": Shield, players: Users, "my-athletes": Users,
  review: ClipboardList, "hs-review": ClipboardList, evaluate: ClipboardCheck, "coach-evals": ClipboardCheck,
  development: TrendingUp, scout: Crosshair, discover: Crosshair, watchlist: Star,
  compare: ArrowLeftRight, "my-evaluations": ClipboardList, submitted: ClipboardList,
  "my-id": IdCard, settings: Settings, reports: BarChart3,
};

const STAFF_ONLY_PREFIXES = [
  "/players", "/evaluate", "/evaluation", "/events", "/review", "/reports", "/scout",
  "/staff", "/templates", "/drills", "/audit-log", "/development", "/my-evaluations", "/programs",
  "/teams",
];

/** An uploaded logo is served by the authenticated /organization/logo route and
 *  stored as "/api/organization/logo?v=…", so it needs a signed URL. A logo set
 *  by pasting an external https link renders as-is. Same rule as PlayerAvatar. */
export const resolveOrgLogoSrc = (logoUrl) => {
  if (!logoUrl) return null;
  if (/^(https?:|data:)/i.test(logoUrl)) return logoUrl;
  return signedUrl(logoUrl.startsWith("/api/") ? logoUrl.slice(4) : logoUrl);
};

/** Org identity mark: logo when the payload carries one, styled initial block otherwise. */
const OrgMark = ({ name, logoUrl, className }) => {
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => { setImgFailed(false); }, [logoUrl]);
  const src = logoUrl && !imgFailed ? resolveOrgLogoSrc(logoUrl) : null;
  if (src) {
    return (
      <img
        src={src}
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

/**
 * Compact "Switch Workspace" control. Purely presentational — only the
 * workspaces the account's role is authorized for are ever offered.
 * Hidden entirely for single-workspace users.
 */
const WorkspaceSwitcher = ({ workspace, workspaces, onSwitch, onNavigate }) => {
  if ((workspaces || []).length <= 1) return null;
  const current = WORKSPACE_META[workspace] || WORKSPACE_META.evaluator;
  const CurrentIcon = current.icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="workspace-switcher"
          className="w-full flex items-center gap-2 rounded-xl border border-border bg-secondary/60 px-3 py-2 text-left hover:bg-secondary transition"
        >
          <div className="h-7 w-7 rounded-lg bg-brand-tertiary ring-1 ring-brand/40 flex items-center justify-center shrink-0">
            <CurrentIcon className="h-3.5 w-3.5 text-brand" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground">Workspace</p>
            <p className="text-sm font-semibold text-foreground truncate">{current.label}</p>
          </div>
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((key) => {
          const meta = WORKSPACE_META[key];
          if (!meta) return null;
          const Icon = meta.icon;
          return (
            <DropdownMenuItem
              key={key}
              data-testid={`workspace-option-${key}`}
              onClick={() => { onSwitch(key); onNavigate?.(); }}
              className="flex items-start gap-2 cursor-pointer"
            >
              <Check className={cn("h-4 w-4 mt-0.5", key === workspace ? "opacity-100 text-brand" : "opacity-0")} />
              <Icon className="h-4 w-4 mt-0.5 text-brand" />
              <div className="min-w-0">
                <p className="font-semibold truncate">{meta.label}</p>
                <p className="text-[11px] text-muted-foreground">{meta.blurb}</p>
              </div>
            </DropdownMenuItem>
          );
        })}
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
  const navigate = useNavigate();
  const role = user?.role || "evaluator";

  // Active workspace: stored per user, guarded against unauthorized values.
  const workspaces = getAuthorizedWorkspaces(role);
  const [workspace, setWorkspace] = useState(() => getActiveWorkspace(user));
  useEffect(() => { setWorkspace(getActiveWorkspace(user)); }, [user?.id, role]); // eslint-disable-line react-hooks/exhaustive-deps
  const activeWorkspace = workspaces.includes(workspace) ? workspace : workspaces[0];

  const switchWorkspace = (key) => {
    if (!workspaces.includes(key)) return; // lens, not an access grant
    persistWorkspace(user?.id, key);
    setWorkspace(key);
    navigate(WORKSPACE_HOME[key] || "/dashboard");
  };

  const navKeys = NAV_BY_WORKSPACE[activeWorkspace] || NAV_BY_WORKSPACE.evaluator;
  const adminKeys = ADMIN_BY_WORKSPACE[activeWorkspace] || [];
  const mobileKeys = MOBILE_PRIMARY_BY_WORKSPACE[activeWorkspace] || MOBILE_PRIMARY_BY_WORKSPACE.evaluator;
  const moreKeys = [...navKeys, ...adminKeys].filter((k) => !mobileKeys.includes(k));
  const focusMode = location.pathname.startsWith("/evaluation/");
  const chooserMode = location.pathname === "/workspace";
  const hideChrome = focusMode || chooserMode;

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

  // First arrival: multi-workspace users with no stored choice pick once at
  // /workspace ("Where are you working today?"). Single-workspace users and
  // returning users go straight in — never force a selection every login.
  if (location.pathname === "/dashboard" && workspaces.length > 1 && !hasStoredWorkspace(user)) {
    return <Navigate to="/workspace" replace />;
  }

  return (
    <WorkspaceContext.Provider value={{ workspace: activeWorkspace, workspaces, switchWorkspace }}>
    <div className="min-h-screen bg-background">
      <aside className={cn("hidden md:flex fixed inset-y-0 left-0 w-[268px] flex-col border-r border-border bg-surface-2 z-40", hideChrome && "md:hidden")} data-testid="desktop-sidebar-nav">
        <div className="px-5 py-5 border-b border-divider space-y-3">
          <Logo />
          <OrgSwitcher />
          <WorkspaceSwitcher workspace={activeWorkspace} workspaces={workspaces} onSwitch={switchWorkspace} />
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

      {!hideChrome && (
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

      <main className={cn(!hideChrome && "md:pl-[268px]")}>
        <div
          className={cn(
            "mx-auto max-w-[1200px] px-4 sm:px-6 pt-5 sm:pt-7",
            focusMode
              ? "pb-6 max-w-2xl"
              : chooserMode
                ? "pb-10"
                : "pb-safe-nav md:pb-10"
          )}
        >
          {children}
        </div>
      </main>

      {!hideChrome && (
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
                data-testid={`mobile-bottom-nav-${MOBILE_SLUGS[k] || (MOBILE_LABELS[k] || item.label).toLowerCase().replace(/\s+/g, "-")}`}
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
                <div className="mb-3">
                  <WorkspaceSwitcher
                    workspace={activeWorkspace}
                    workspaces={workspaces}
                    onSwitch={switchWorkspace}
                    onNavigate={() => setMoreOpen(false)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {moreKeys.map((k) => {
                    const item = NAV_ITEMS[k];
                    const Icon = item.icon;
                    return (
                      <NavLink
                        key={k}
                        to={item.to}
                        onClick={() => setMoreOpen(false)}
                        data-testid={`more-nav-${navSlug(item)}`}
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
    </WorkspaceContext.Provider>
  );
};
