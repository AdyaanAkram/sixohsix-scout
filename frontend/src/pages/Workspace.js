import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
  WORKSPACE_META, WORKSPACE_HOME, getAuthorizedWorkspaces, getActiveWorkspace,
  persistWorkspace, useWorkspace, OrgSwitcher,
} from "@/components/layout/AppLayout";
import {
  ArrowRight, ShieldCheck, BadgeCheck, TrendingUp, Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Role-based landing experience — shown right after sign-in.
 * Org identity sits at the top, then one rich card per AUTHORIZED workspace
 * (a workspace is a lens, not an access grant — roles the account isn't
 * entitled to are never shown). Tapping Enter persists the choice per user
 * and routes to that workspace's home.
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
        "group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-card text-left transition-all",
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
  const workspaces = getAuthorizedWorkspaces(user?.role);
  const current = getActiveWorkspace(user);

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

        <div
          className={cn(
            "mt-8 grid gap-4",
            workspaces.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4"
              : workspaces.length === 3 ? "sm:grid-cols-3"
              : workspaces.length === 2 ? "mx-auto w-full max-w-2xl sm:grid-cols-2"
              : "mx-auto w-full max-w-sm"
          )}
        >
          {workspaces.map((key) => {
            const meta = WORKSPACE_META[key];
            const style = MODE_STYLE[key];
            if (!meta || !style) return null;
            return (
              <ModeCard
                key={key}
                wsKey={key}
                meta={meta}
                style={style}
                active={key === current}
                onEnter={() => choose(key)}
              />
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
