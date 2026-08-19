import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg, signedUrl } from "@/lib/api";
import { toast } from "sonner";
import {
  LayoutDashboard, CalendarDays, Users, ClipboardList, BarChart3, TrendingUp,
  UserCog, FileSpreadsheet, Settings, LogOut, Home, ClipboardCheck,
  MoreHorizontal, ScrollText, IdCard, CalendarRange, Bell, Dumbbell,
  ChevronsUpDown, Building2, Check, Crosshair, Shield, Star, ArrowLeftRight, ShoppingBag,
  Plus, SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  // Staff roles never imply the athlete lens on their own — it is added only
  // when the ACCOUNT actually owns or guards an athlete profile
  // (`has_athlete_profile`), see getAuthorizedWorkspaces below.
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

/** Canonical display order — staff lenses first, the personal lens last. */
const WORKSPACE_ORDER = ["hq", "coach", "scout", "evaluator", "athlete"];

/** Every staff role the account holds, across all of its active memberships. */
export const getStaffRoles = (user) =>
  (Array.isArray(user?.staff_roles) ? user.staff_roles : []).filter((r) => !!WORKSPACES_BY_ROLE[r]);

/**
 * Authorized workspaces for the WHOLE PERSON, not for one membership row.
 * People hold more than one hat: a coach who is also a parent, a parent who
 * gets invited to coach. The lens list is therefore the union of
 *   1. the workspaces of the current membership role (`user.role`),
 *   2. the workspaces of every staff role held anywhere (`user.staff_roles`),
 *   3. the athlete lens when the account owns or guards an athlete profile
 *      (`user.has_athlete_profile`) — always last.
 * A workspace is still only a LENS: every route keeps its own role gates.
 *
 * Backward compatible: a bare role string is treated as that role with no
 * extra capabilities, so legacy `getAuthorizedWorkspaces(user?.role)` callers
 * keep their exact previous result.
 */
export const getAuthorizedWorkspaces = (userOrRole) => {
  if (typeof userOrRole === "string") {
    return WORKSPACES_BY_ROLE[userOrRole] || WORKSPACES_BY_ROLE.evaluator;
  }
  const user = userOrRole || {};
  const allowed = new Set(WORKSPACES_BY_ROLE[user.role] || WORKSPACES_BY_ROLE.evaluator);
  getStaffRoles(user).forEach((r) => {
    (WORKSPACES_BY_ROLE[r] || []).forEach((ws) => allowed.add(ws));
  });
  if (user.has_athlete_profile) allowed.add("athlete");
  const ordered = WORKSPACE_ORDER.filter((ws) => allowed.has(ws));
  return ordered.length ? ordered : WORKSPACES_BY_ROLE.evaluator;
};

const workspaceStorageKey = (userId) => `606_workspace_${userId || "anon"}`;

/** True only when a stored choice exists AND it is still authorized. */
export const hasStoredWorkspace = (user) => {
  const authorized = getAuthorizedWorkspaces(user);
  let stored = null;
  try { stored = localStorage.getItem(workspaceStorageKey(user?.id)); } catch { /* ignore */ }
  return !!stored && authorized.includes(stored);
};

/** Active workspace = stored choice if authorized, else first authorized. */
export const getActiveWorkspace = (user) => {
  const authorized = getAuthorizedWorkspaces(user);
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
  hq: ["review", "evaluate", "scout", "reports", "programs", "store", "staff", "templates", "drills", "audit", "settings"],
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
  store: { to: "/manage/store", label: "Store", icon: ShoppingBag },
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
  hq: ["dashboard", "review", "players", "events"],
  coach: ["dashboard", "coach-evals", "my-athletes", "development"],
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

/* Create a new organization. Module level ON PURPOSE — an inline component
   would remount on every keystroke and the fields would lose focus. */
const CreateOrgDialog = ({ open, onOpenChange, onCreated }) => {
  const [form, setForm] = useState({ name: "", full_name: "", contact_email: "", city: "", state: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post("/organizations", {
        name: form.name.trim(),
        full_name: form.full_name.trim() || null,
        contact_email: form.contact_email.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
      });
      toast.success(`${form.name.trim()} created.`);
      setForm({ name: "", full_name: "", contact_email: "", city: "", state: "" });
      onOpenChange(false);
      onCreated?.(r.data);
    } catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl" data-testid="create-org-dialog">
        <DialogHeader><DialogTitle className="font-display text-2xl text-foreground">New organization</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-muted-foreground">
            You become its owner. Logo, colors and the family join code are set afterwards in Settings.
          </p>
          <div className="space-y-1">
            <Label className="text-xs">Organization name *</Label>
            <Input value={form.name} onChange={set("name")} className="h-10 rounded-lg" placeholder="606 Athletics South" data-testid="create-org-name" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Full legal name</Label>
            <Input value={form.full_name} onChange={set("full_name")} className="h-10 rounded-lg" data-testid="create-org-full-name" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Contact email</Label>
            <Input type="email" value={form.contact_email} onChange={set("contact_email")} className="h-10 rounded-lg" data-testid="create-org-email" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">City</Label>
              <Input value={form.city} onChange={set("city")} className="h-10 rounded-lg" data-testid="create-org-city" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">State</Label>
              <Input value={form.state} onChange={set("state")} className="h-10 rounded-lg" data-testid="create-org-state" />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !form.name.trim()} className="h-11 w-full rounded-xl bg-primary hover:bg-brand-secondary" data-testid="create-org-submit">
              {busy ? "Creating…" : "Create organization"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export const OrgSwitcher = ({ compact, large }) => {
  const { user, switchOrganization } = useAuth();
  const [orgs, setOrgs] = useState(user?.memberships || []);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    api.get("/auth/memberships")
      .then((r) => setOrgs(r.data || []))
      .catch(() => setOrgs(user?.memberships || []));
  }, [user?.organization_id, user?.memberships]);

  const multi = (orgs || []).length > 1;
  if (!user) return null;
  // An owner always gets the menu — with one organization there would otherwise
  // be no route to creating or managing another.
  const canManageOrgs = user.role === "owner";

  // logo_url may arrive on the user payload or the current membership — render defensively.
  const current = (orgs || []).find((o) => o.organization_id === user.organization_id);
  const logoUrl = user.organization_logo_url || user.organization?.logo_url
    || current?.logo_url || current?.organization_logo_url || null;

  if (!multi && !canManageOrgs) {
    return (
      <div className={cn("flex items-center gap-2.5 px-3 py-2 rounded-xl bg-secondary/60 border border-border", compact && "py-1.5", large && "px-4 py-3 gap-3")}>
        <OrgMark name={user.organization_name} logoUrl={logoUrl} />
        <div className="min-w-0">
          <p className={cn("text-sm font-semibold text-foreground truncate", large && "text-base")} data-testid="current-org-name">
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
            compact && "w-auto max-w-[180px]",
            large && "px-4 py-3 gap-3"
          )}
        >
          <OrgMark name={user.organization_name} logoUrl={logoUrl} />
          <div className="min-w-0 flex-1">
            <p className={cn("text-sm font-semibold text-foreground truncate", large && "text-base")}>{user.organization_name}</p>
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground truncate">
              {large ? "Tap to switch organization" : "Powered by 60'6\" ID"}
            </p>
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
        {canManageOrgs && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-2 cursor-pointer"
              data-testid="org-create-item"
            >
              <Plus className="h-4 w-4 text-brand" />
              <span className="font-semibold">New organization</span>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="cursor-pointer" data-testid="org-manage-item">
              <NavLink to="/settings" className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                <span>Edit this organization</span>
              </NavLink>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
      {canManageOrgs && (
        <CreateOrgDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(org) => { if (org?.id) onSwitch(org.id); }}
        />
      )}
    </DropdownMenu>
  );
};

/**
 * Sidebar mode tile — shows the current mode and returns to the full-screen
 * mode picker (/workspace) where both mode AND organization are chosen.
 * Hidden for single-workspace users (nothing to pick).
 */
const ModePickerTile = ({ workspace, workspaces, onOpen }) => {
  if ((workspaces || []).length <= 1) return null;
  const current = WORKSPACE_META[workspace] || WORKSPACE_META.evaluator;
  const CurrentIcon = current.icon;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="mode-picker-button"
      className="w-full flex items-center gap-2 rounded-xl border border-border bg-secondary/60 px-3 py-2 text-left hover:bg-secondary transition"
    >
      <div className="h-7 w-7 rounded-lg bg-brand-tertiary ring-1 ring-brand/40 flex items-center justify-center shrink-0">
        <CurrentIcon className="h-3.5 w-3.5 text-brand" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground">Mode</p>
        <p className="text-sm font-semibold text-foreground truncate">{current.label}</p>
      </div>
      <ArrowLeftRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </button>
  );
};

export const AppLayout = ({ children }) => {
  const { user, logout } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [approvedNotifs, setApprovedNotifs] = useState({}); // notif id -> approved via the sheet
  const [notifs, setNotifs] = useState([]);
  const [unread, setUnread] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();
  const role = user?.role || "evaluator";

  // Active workspace: stored per user, guarded against unauthorized values.
  // Resolved from the whole account (membership role + every staff role held +
  // a linked athlete profile), so dual-role people keep both sets of lenses.
  const workspaces = getAuthorizedWorkspaces(user);
  // Capability signature — re-resolves when the account gains a staff role or a
  // linked athlete profile without the user id changing (e.g. after /auth/me).
  const capabilities = `${role}|${getStaffRoles(user).join(",")}|${user?.has_athlete_profile ? 1 : 0}`;
  const [workspace, setWorkspace] = useState(() => getActiveWorkspace(user));
  useEffect(() => { setWorkspace(getActiveWorkspace(user)); }, [user?.id, capabilities]); // eslint-disable-line react-hooks/exhaustive-deps
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
          <ModePickerTile workspace={activeWorkspace} workspaces={workspaces} onOpen={() => navigate("/workspace")} />
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
          <div className="flex items-center justify-between mb-4">
            <p className="font-display text-2xl text-foreground">Notifications</p>
            {notifs.length > 0 && (
              <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs"
                data-testid="notifications-clear-all"
                onClick={async () => {
                  try {
                    await api.delete("/notifications");
                    setNotifs([]);
                    setUnread(0);
                    toast.success("Notifications cleared.");
                  } catch (e) { toast.error(errMsg(e)); }
                }}>
                Clear all
              </Button>
            )}
          </div>
          <div className="space-y-2 max-h-[80vh] overflow-y-auto">
            {notifs.length === 0 ? (
              <p className="text-sm text-muted-foreground">You&apos;re all caught up.</p>
            ) : (
              notifs.map((n) => {
                // Every notification deep-links to the place you act on it.
                const dest = (() => {
                  const p = n.payload || {};
                  switch (n.kind) {
                    case "signup_pending": return "/players";
                    case "assessment_published":
                    case "moment_approved":
                    case "moment_rejected":
                    case "org_added": return "/my-id";
                    case "event_invite": return p.code ? `/redeem?code=${p.code}` : "/redeem";
                    case "award_pending": return p.athlete_id ? `/players/${p.athlete_id}?tab=awards` : "/players";
                    default:
                      if (p.event_id) return `/events/${p.event_id}`;
                      if (p.athlete_id) return `/players/${p.athlete_id}`;
                      return null;
                  }
                })();
                const canApprove = n.kind === "signup_pending" && (n.payload?.athlete_ids || []).length > 0 && !approvedNotifs[n.id];
                return (
                  <div
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => { if (dest) { setNotifOpen(false); navigate(dest); } }}
                    className={cn("w-full text-left rounded-xl border border-border px-3 py-2.5 transition-colors",
                      !n.read && "bg-secondary/50", dest && "hover:border-brand/50 cursor-pointer")}
                    data-testid={`notification-item-${n.id}`}
                  >
                    <p className="text-sm font-semibold text-foreground">{n.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <p className="text-[10px] text-muted-foreground">{(n.created_at || "").slice(0, 16).replace("T", " ")}{dest ? " · tap to open" : ""}</p>
                      {canApprove && (
                        <Button
                          size="sm"
                          className="h-7 rounded-lg text-xs bg-primary hover:bg-brand-secondary shrink-0"
                          data-testid={`notification-approve-${n.id}`}
                          onClick={async (ev) => {
                            ev.stopPropagation();
                            let ok = 0, already = 0;
                            for (const aid of n.payload.athlete_ids) {
                              try { await api.post(`/athletes/${aid}/approve`); ok += 1; }
                              catch (e2) { if (e2?.response?.status === 404) already += 1; else toast.error(errMsg(e2)); }
                            }
                            setApprovedNotifs((m) => ({ ...m, [n.id]: true }));
                            toast.success(ok > 0 ? `Approved ${ok} athlete${ok > 1 ? "s" : ""}.` : already > 0 ? "Already approved." : "Nothing to approve.");
                          }}
                        >
                          Approve
                        </Button>
                      )}
                      {n.kind === "signup_pending" && approvedNotifs[n.id] && (
                        <span className="text-xs font-semibold text-success shrink-0">Approved ✓</span>
                      )}
                    </div>
                  </div>
                );
              })
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
                  <ModePickerTile
                    workspace={activeWorkspace}
                    workspaces={workspaces}
                    onOpen={() => { setMoreOpen(false); navigate("/workspace"); }}
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
