import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
  WORKSPACE_META, WORKSPACE_HOME, getAuthorizedWorkspaces, getActiveWorkspace,
  getStaffRoles, hasStoredWorkspace, persistWorkspace, useWorkspace, OrgSwitcher,
} from "@/components/layout/AppLayout";
import {
  ArrowRight, ShieldCheck, BadgeCheck, TrendingUp, Trophy, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Role-based landing experience — shown right after sign-in.
 * Org identity sits at the top, then one rich card per AUTHORIZED workspace
 * (a workspace is a lens, not an access grant — roles the account isn't
 * entitled to are never shown). Tapping Enter persists the choice per user
 * and routes to that workspace's home.
 *
 * People hold more than one hat: a coach whose child trains here, a parent
 * invited to coach. Those accounts see their staff cards AND the My
 * Development card side by side, and switch between them from this screen.
 *
 * Per-mode accent colors are a deliberate identity system (mirrors the client
 * mockups): HQ red, Coach blue, Evaluator green, Scout purple, Athlete amber.
 * Scout purple is the one accent the theme has no token for.
 */
const SCOUT_PURPLE = "262 60% 58%";

const MODE_STYLE = {
  hq: {
    accent: "var(--brand)",
    blurb: "Run your entire organization.",
    cta: "Enter Organization HQ",
    points: ["Rosters & events", "Review & publish", "Staff & templates"],
  },
  coach: {
    accent: "var(--info)",
    blurb: "Manage and develop your athletes.",
    cta: "Enter Coach Hub",
    points: ["My teams & athletes", "Development focus", "Progress tracking"],
  },
  evaluator: {
    accent: "var(--success)",
    blurb: "Evaluate athletes at events.",
    cta: "Enter Evaluation Mode",
    points: ["Today's stations", "Field scoring", "Submit & done"],
  },
  scout: {
    accent: SCOUT_PURPLE,
    blurb: "Discover and evaluate top prospects.",
    cta: "Enter Scout Mode",
    points: ["Discover & compare", "Watchlist", "Leaderboards"],
  },
  athlete: {
    accent: "var(--warning)",
    blurb: "Track your development and results.",
    cta: "Enter My Development",
    points: ["My 60'6\" ID", "Results & recaps", "Goals & milestones"],
  },
};

/* A staff member with a linked athlete profile is looking at their FAMILY, not
   at themselves — the same lens, framed honestly. */
const familyAthleteStyle = (linkedCount) => ({
  ...MODE_STYLE.athlete,
  blurb: linkedCount > 1
    ? "Your athletes' profiles, progress and goals."
    : "Your athlete's profile, progress and goals.",
  points: ["Their 60'6\" ID", "Results & recaps", "Goals & milestones"],
});

/* Card widths per card count. Flex-wrap rather than a fixed 4-up grid: it keeps
   every row balanced and centres a partial last row, which matters now that the
   athlete lens can push an account to 5 modes (owner/admin with a child). */
const CARD_WIDTH_BY_COUNT = {
  1: "w-full max-w-sm",
  2: "w-full sm:w-[calc(50%_-_0.5rem)]",
  3: "w-full sm:w-[calc(50%_-_0.5rem)] lg:w-[calc(33.333%_-_0.667rem)]",
  4: "w-full sm:w-[calc(50%_-_0.5rem)] lg:w-[calc(25%_-_0.75rem)]",
  5: "w-full sm:w-[calc(50%_-_0.5rem)] lg:w-[calc(33.333%_-_0.667rem)]",
};

const STAFF_NOUNS = {
  owner: "an owner",
  admin: "an administrator",
  head_scout: "a head scout",
  coach: "a coach",
  evaluator: "an evaluator",
};

const dualRoleNoticeKey = (userId) => `606_dual_role_notice_dismissed_${userId || "anon"}`;

const readDualRoleNoticeDismissed = (userId) => {
  try { return localStorage.getItem(dualRoleNoticeKey(userId)) === "1"; } catch { return false; }
};

/* Quiet one-time strip for someone who just gained a staff hat on an account
   that already follows an athlete. Not a modal — nothing is required of them. */
const DualRoleNotice = ({ noun, tools, onDismiss }) => (
  <div
    data-testid="dual-role-notice"
    className="mt-8 flex items-start gap-3 rounded-2xl border border-border bg-card p-4"
  >
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-tertiary ring-1 ring-brand/30">
      <ShieldCheck className="h-[18px] w-[18px] text-brand" />
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold text-foreground">You&apos;re set up as {noun} here</p>
      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
        There is nothing else to set up. Your {tools} and your athlete&apos;s profile live in this one
        account — switch between them any time from this screen.
      </p>
    </div>
    <button
      type="button"
      onClick={onDismiss}
      aria-label="Dismiss"
      data-testid="dual-role-notice-dismiss"
      className="-mr-1 -mt-1 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      <X className="h-4 w-4" />
    </button>
  </div>
);

const TRUST_BADGES = [
  { icon: ShieldCheck, title: "One Athlete ID", sub: "All your data. Always with you." },
  { icon: BadgeCheck, title: "Verified & Trusted", sub: "606 standards. Every time." },
  { icon: TrendingUp, title: "Development Focused", sub: "Data that drives improvement." },
  { icon: Trophy, title: "Built for Baseball", sub: "By coaches. For athletes." },
];

const ModeCard = ({ wsKey, meta, style, active, onEnter }) => {
  const Icon = meta.icon;
  const accent = `hsl(${style.accent})`;
  return (
    <div
      data-testid={`workspace-card-${wsKey}`}
      onClick={onEnter}
      className={cn(
        "group relative flex w-full cursor-pointer flex-col overflow-hidden rounded-2xl border bg-card text-left transition-all",
        "hover:-translate-y-1 hover:shadow-xl",
        active ? "border-brand/60 ring-1 ring-brand/40" : "border-border"
      )}
    >
      {/* Visual header — accent gradient with an oversized watermark icon. */}
      <div
        className="relative h-28 shrink-0 overflow-hidden"
        style={{ background: `linear-gradient(150deg, hsl(${style.accent} / 0.28), hsl(${style.accent} / 0.06) 60%, transparent)` }}
      >
        <Icon
          className="absolute -right-4 -bottom-6 h-28 w-28 opacity-[0.12] transition-transform group-hover:scale-110"
          style={{ color: accent }}
        />
        <div
          className="absolute left-4 bottom-4 flex h-12 w-12 items-center justify-center rounded-xl ring-1"
          style={{ background: `hsl(${style.accent} / 0.18)`, borderColor: accent, boxShadow: `inset 0 0 0 1px hsl(${style.accent} / 0.4)` }}
        >
          <Icon className="h-6 w-6" style={{ color: accent }} />
        </div>
        {active && (
          <span className="absolute right-3 top-3 rounded-full bg-background/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
            Last used
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4 pt-3">
        <div>
          <p className="font-display text-xl leading-tight text-foreground">{meta.label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{style.blurb}</p>
        </div>
        <ul className="mb-1 space-y-1">
          {style.points.map((pt) => (
            <li key={pt} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-1 w-1 rounded-full" style={{ backgroundColor: accent }} />
              {pt}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={onEnter}
          data-testid={`workspace-enter-${wsKey}`}
          className="mt-auto inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-semibold text-white transition-all active:scale-[0.98]"
          style={{ background: accent }}
        >
          {style.cta}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
};

export default function Workspace() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const wsCtx = useWorkspace();
  // Lenses come from the whole account: membership role + every staff role held
  // anywhere + a linked athlete profile.
  const workspaces = getAuthorizedWorkspaces(user);
  const current = getActiveWorkspace(user);

  const staffRoles = getStaffRoles(user);
  const isStaff = staffRoles.length > 0;
  const hasFamilyLens = isStaff && !!user?.has_athlete_profile;

  // "New staff capability" heuristic: staff roles, a linked athlete profile and
  // no mode chosen on this device yet.
  const [noticeDismissed, setNoticeDismissed] = useState(() => readDualRoleNoticeDismissed(user?.id));
  useEffect(() => { setNoticeDismissed(readDualRoleNoticeDismissed(user?.id)); }, [user?.id]);
  const showNotice = hasFamilyLens && !noticeDismissed && !hasStoredWorkspace(user);
  const noticeRole = staffRoles.includes("coach") ? "coach" : staffRoles[0];

  const dismissNotice = () => {
    try { localStorage.setItem(dualRoleNoticeKey(user?.id), "1"); } catch { /* ignore */ }
    setNoticeDismissed(true);
  };

  const choose = (key) => {
    if (!workspaces.includes(key)) return;
    if (wsCtx?.switchWorkspace) {
      wsCtx.switchWorkspace(key); // persists + navigates + updates layout state
      return;
    }
    persistWorkspace(user?.id, key);
    navigate(WORKSPACE_HOME[key] || "/dashboard");
  };

  const firstName = user?.full_name ? user.full_name.split(" ")[0] : null;

  return (
    <div className="min-h-screen bg-background hero-sweep flex flex-col" data-testid="workspace-chooser">
      {/* Top bar — brand left, organization right */}
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-tertiary ring-1 ring-brand/50">
            <span className="font-display text-xs font-extrabold leading-none text-brand">60</span>
          </div>
          <div className="leading-none">
            <p className="font-display text-xl text-foreground">60&apos;6&quot; ID</p>
            <p className="text-[9px] uppercase tracking-[0.14em] text-brand">Train. Elevate. Succeed.</p>
          </div>
        </div>
        <div className="w-full sm:w-auto sm:min-w-[320px]">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Organization
          </p>
          <OrgSwitcher large />
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-8 sm:px-6">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Welcome{firstName ? ` back, ${firstName}` : " to 60'6\" ID"}
          </p>
          <h1 className="mt-2 font-display text-3xl text-foreground sm:text-5xl">
            How would you like to continue?
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Your experience adapts to your role. Pick a mode — you can switch anytime without signing out.
          </p>
        </div>

        {showNotice && (
          <DualRoleNotice
            noun={STAFF_NOUNS[noticeRole] || "staff"}
            tools={noticeRole === "coach" ? "coaching tools" : "staff tools"}
            onDismiss={dismissNotice}
          />
        )}

        <div
          className={cn(
            "mt-8 flex flex-wrap justify-center gap-4",
            workspaces.length === 2 && "mx-auto w-full max-w-2xl"
          )}
          data-testid="workspace-card-grid"
        >
          {workspaces.map((key) => {
            const meta = WORKSPACE_META[key];
            const style = key === "athlete" && hasFamilyLens
              ? familyAthleteStyle(user?.linked_athlete_count || 0)
              : MODE_STYLE[key];
            if (!meta || !style) return null;
            return (
              <div
                key={key}
                className={cn("flex", CARD_WIDTH_BY_COUNT[workspaces.length] || CARD_WIDTH_BY_COUNT[4])}
              >
                <ModeCard
                  wsKey={key}
                  meta={meta}
                  style={style}
                  active={key === current}
                  onEnter={() => choose(key)}
                />
              </div>
            );
          })}
        </div>

        {/* Trust strip */}
        <div className="mt-10 grid grid-cols-2 gap-3 rounded-2xl border border-border bg-card/60 p-4 backdrop-blur sm:grid-cols-4">
          {TRUST_BADGES.map(({ icon: Icon, title, sub }) => (
            <div key={title} className="flex items-start gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-tertiary ring-1 ring-brand/30">
                <Icon className="h-4 w-4 text-brand" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">{title}</p>
                <p className="text-[10px] leading-snug text-muted-foreground">{sub}</p>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
