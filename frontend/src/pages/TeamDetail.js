import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import {
  ArrowLeft, ChevronRight, ClipboardList, Flag, Minus, Shield, Sparkles,
  Target, TrendingDown, TrendingUp, Users, Video,
} from "lucide-react";

/*
  Team drill-down (client direction: "Selecting a Team should drill into that
  team's roster, evaluations, development and events"). Derived entirely from
  GET /teams/{name}/summary — no schema change. On 404 we explain that teams
  appear once athletes have a team set; no numbers are fabricated.
*/

const fmtScore = (v) => {
  if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

// Route params are URL-encoded; react-router usually decodes, but be safe either way.
const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

// One chip per athlete — highest-priority status only (matches PlayersList semantics).
const STATUS_PRIORITY = [
  { key: "follow_up", label: "Follow-Up", icon: Flag, style: "bg-warning/15 text-warning border-warning/40" },
  { key: "needs_evaluation", label: "Needs Evaluation", icon: ClipboardList, style: "border-dashed border-[hsl(var(--border-strong))] bg-transparent text-muted-foreground" },
  { key: "personal_best", label: "Personal Best", icon: Sparkles, style: "bg-[hsl(var(--info)/0.15)] text-info border-[hsl(var(--info)/0.4)]" },
  { key: "new_video", label: "New Video", icon: Video, style: "bg-[hsl(var(--info)/0.15)] text-info border-[hsl(var(--info)/0.4)]" },
  { key: "improving", label: "Improving", icon: TrendingUp, style: "bg-success/15 text-success border-success/40" },
  { key: "evaluated", label: "Evaluated", icon: null, style: "bg-secondary text-muted-foreground border-border" },
];

const TopStatusChip = ({ statuses }) => {
  const top = STATUS_PRIORITY.find((s) => statuses?.[s.key]);
  if (!top) return null;
  const Icon = top.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold", top.style)}>
      {Icon && <Icon className="h-3 w-3 shrink-0" />}
      {top.label}
    </span>
  );
};

const TrendArrow = ({ change }) => {
  if (change === null || change === undefined || Number.isNaN(Number(change))) return null;
  const n = Number(change);
  const Icon = n > 0 ? TrendingUp : n < 0 ? TrendingDown : Minus;
  const color = n > 0 ? "text-success" : n < 0 ? "text-destructive" : "text-muted-foreground";
  return <Icon className={cn("h-4 w-4 shrink-0", color)} />;
};

const HeroStat = ({ label, value, sub }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-2xl font-bold font-mono-num text-foreground">{value}</p>
    {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
  </div>
);

export default function TeamDetail() {
  const { teamName } = useParams();
  const navigate = useNavigate();
  const displayName = safeDecode(teamName || "");
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    api
      .get(`/teams/${encodeURIComponent(displayName)}/summary`)
      .then((r) => {
        if (!cancelled) setSummary(r.data && typeof r.data === "object" ? r.data : null);
      })
      .catch(() => {
        if (!cancelled) {
          setSummary(null);
          setNotFound(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamName]);

  if (loading) {
    return (
      <div className="space-y-4" data-testid="team-detail">
        <Skeleton className="h-8 w-40 rounded-xl" />
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (notFound || !summary) {
    return (
      <div className="space-y-4" data-testid="team-detail">
        <Link to="/teams" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="team-detail-back-link">
          <ArrowLeft className="h-3.5 w-3.5" /> Teams
        </Link>
        <EmptyState
          icon={Shield}
          title={`No data for "${displayName}"`}
          hint="Teams appear automatically once athletes in the directory have this team set on their profile."
        />
      </div>
    );
  }

  const athletes = Array.isArray(summary.athletes) ? summary.athletes : [];
  const gradYears = Array.isArray(summary.grad_years) ? summary.grad_years : [];
  const recentEvals = Array.isArray(summary.recent_evaluations) ? summary.recent_evaluations : [];
  const improving = summary.improving ?? athletes.filter((a) => Number(a.score_change) > 0).length;
  const declining = athletes.filter((a) => Number(a.score_change) < 0).length;
  const focuses = [...new Set(athletes.map((a) => a.development_focus).filter(Boolean))];

  return (
    <div className="space-y-4" data-testid="team-detail">
      <Link to="/teams" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="team-detail-back-link">
        <ArrowLeft className="h-3.5 w-3.5" /> Teams
      </Link>

      {/* Hero — five-second summary */}
      <Card className="rounded-2xl border-border">
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-4xl text-foreground">{summary.team || displayName}</h1>
              <p className="text-sm text-muted-foreground">
                {summary.athlete_count ?? athletes.length} athlete{(summary.athlete_count ?? athletes.length) === 1 ? "" : "s"} on this team
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-success/15 border border-success/40 px-2.5 py-0.5 text-xs font-semibold text-success">
                <TrendingUp className="h-3 w-3" /> {summary.improving ?? 0} improving
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 border border-warning/40 px-2.5 py-0.5 text-xs font-semibold text-warning">
                <Flag className="h-3 w-3" /> {summary.follow_up ?? 0} follow-up
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-8">
            <HeroStat label="Athletes" value={summary.athlete_count ?? athletes.length} />
            <HeroStat
              label="Avg score"
              value={fmtScore(summary.avg_score)}
              sub={summary.avg_score === null || summary.avg_score === undefined ? "Not enough data yet" : null}
            />
            <HeroStat label="Active goals" value={summary.active_goals ?? "—"} />
          </div>

          {gradYears.length > 0 && (
            <div className="flex flex-wrap gap-2" data-testid="team-detail-gradyear-chips">
              {gradYears.map((g) => (
                <Link
                  key={g.year}
                  to={`/players?graduation_year=${g.year}`}
                  className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground hover:border-brand/50 hover:text-foreground transition-colors"
                  data-testid={`team-detail-gradyear-chip-${g.year}`}
                >
                  Class of {g.year}{g.count !== null && g.count !== undefined ? ` (${g.count})` : ""}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Development strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Link to="/development" data-testid="team-detail-goals-link">
          <Card className="rounded-2xl border-border h-full hover:border-brand/50 transition">
            <CardContent className="p-4 flex items-center gap-3">
              <Target className="h-6 w-6 text-brand shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-lg font-bold font-mono-num text-foreground">{summary.active_goals ?? "—"}</p>
                <p className="text-xs text-muted-foreground">Active development goals</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Card className="rounded-2xl border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <TrendingUp className="h-6 w-6 text-success shrink-0" />
            <div>
              <p className="text-lg font-bold font-mono-num text-foreground">
                {improving} <span className="text-muted-foreground font-normal text-sm">up</span> · {declining} <span className="text-muted-foreground font-normal text-sm">down</span>
              </p>
              <p className="text-xs text-muted-foreground">Score movement across the roster</p>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <Sparkles className="h-6 w-6 text-info shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">
                {focuses.length > 0 ? focuses.slice(0, 3).join(", ") : "Not enough data yet"}
              </p>
              <p className="text-xs text-muted-foreground">Development focus areas</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Roster */}
      <div className="space-y-2">
        <h2 className="font-display text-2xl text-foreground">Roster</h2>
        {athletes.length === 0 ? (
          <EmptyState icon={Users} title="No athletes" hint="Athletes appear here once they have this team set on their profile." />
        ) : (
          <div className="space-y-2" data-testid="team-roster">
            {athletes.map((a) => (
              <Card
                key={a.id}
                className="rounded-2xl border-border cursor-pointer hover:border-brand/50 active:scale-[0.99] transition"
                onClick={() => navigate(`/players/${a.id}`)}
                data-testid={`team-roster-row-${a.id}`}
              >
                <CardContent className="py-3.5 flex items-center gap-3">
                  <PlayerAvatar firstName={a.first_name} lastName={a.last_name} photoUrl={a.photo_url} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground truncate">
                      {a.first_name} {a.last_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.graduation_year ? `Class of ${a.graduation_year} · ` : ""}
                      {a.primary_position || "—"}
                    </p>
                  </div>
                  <div className="hidden sm:block">
                    <TopStatusChip statuses={a.statuses} />
                  </div>
                  <div className="flex items-center gap-1.5 w-16 justify-end">
                    <span className="text-base font-bold font-mono-num text-foreground">{fmtScore(a.latest_overall)}</span>
                    <TrendArrow change={a.score_change} />
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Recent evaluations — rows open the athlete profile, never the eval form */}
      <div className="space-y-2">
        <h2 className="font-display text-2xl text-foreground">Recent Evaluations</h2>
        {recentEvals.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No evaluations yet" hint="Submitted evaluations for this team's athletes will show up here." />
        ) : (
          <Card className="rounded-2xl border-border overflow-hidden">
            <div className="divide-y divide-border" data-testid="team-recent-evaluations">
              {recentEvals.map((ev, i) => (
                <Link
                  key={`${ev.athlete_id}-${ev.submitted_at || i}`}
                  to={`/players/${ev.athlete_id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-secondary transition-colors"
                  data-testid={`team-recent-eval-${i}`}
                >
                  <ClipboardList className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 min-w-0 font-semibold text-foreground truncate">{ev.athlete_name}</span>
                  <span className="text-sm font-bold font-mono-num text-foreground">{fmtScore(ev.overall_score)}</span>
                  <span className="text-xs text-muted-foreground w-28 text-right">{fmtDate(ev.submitted_at)}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </Link>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
