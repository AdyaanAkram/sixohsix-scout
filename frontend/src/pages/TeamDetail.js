import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { resolvePhotoSrc } from "@/components/common/PlayerAvatar";
import {
  AlertTriangle, ArrowLeft, BarChart3, ChevronRight, ClipboardCheck,
  ClipboardList, Minus, Shield, Target, TrendingDown, TrendingUp, Users,
} from "lucide-react";

/*
  Team Overview drill-down (client direction: "Selecting a Team should drill
  into that team's roster, evaluations, development and events"). Derived
  entirely from GET /teams/{name}/summary — no schema change. The summary's
  athletes are Task-1 shaped (statuses / latest_overall / score_change), so the
  snapshot band is computed from data already fetched. On 404 we explain that
  teams appear once athletes have a team set; no numbers are fabricated.
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

const teamInitials = (team) =>
  (team || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

const pct = (x, total) => (total ? Math.round((x / total) * 100) : 0);

/* Scouting-card status pill (PlayersList semantics). Priority: follow_up >
   needs eval > improving > evaluated. Warning = needs attention. */
const CardStatusPill = ({ statuses }) => {
  const s = statuses || {};
  let label = "EVALUATED";
  let cls = "bg-success text-white";
  let trending = false;
  if (s.follow_up) {
    label = "FOLLOW-UP";
    cls = "bg-warning text-black";
  } else if (!s.evaluated) {
    label = "NEEDS EVAL";
    cls = "bg-warning text-black";
  } else if (s.improving) {
    trending = true;
  }
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-md", cls)}>
      {trending ? <TrendingUp className="h-3 w-3" /> : <span aria-hidden="true">•</span>}
      {label}
    </span>
  );
};

/* Photo header for the roster card. Real photo when the athlete has one;
   otherwise a branded monogram panel with a faded position watermark, so a
   photo-less roster still looks intentional rather than broken. */
const CardPhoto = ({ p }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [p.photo_url]);
  const src = !failed ? resolvePhotoSrc(p.photo_url) : null;
  if (src) {
    return (
      <img
        src={src}
        alt={`${p.first_name || ""} ${p.last_name || ""}`.trim() || "Player"}
        className="h-full w-full object-cover object-top"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  const initials = `${(p.first_name || "?")[0] || ""}${(p.last_name || "")[0] || ""}`.toUpperCase();
  return (
    <div className="relative flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-tertiary via-secondary to-background">
      {p.primary_position && (
        <span className="absolute -right-2 bottom-0 select-none font-display text-7xl font-extrabold leading-none text-foreground/[0.06]">
          {p.primary_position}
        </span>
      )}
      <span className="select-none font-display text-5xl text-brand/70">{initials}</span>
    </div>
  );
};

/* Score-change delta with the "since last eval" caption (PlayersList pattern). */
const ChangeSince = ({ change }) => {
  const hasChange = change !== null && change !== undefined && Number.isFinite(Number(change)) && Number(change) !== 0;
  const up = hasChange && Number(change) > 0;
  return (
    <div className="text-right shrink-0">
      {hasChange ? (
        <span className={cn("inline-flex items-center gap-0.5 font-mono-num text-sm font-semibold", up ? "text-success" : "text-warning")}>
          {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
          {up ? "+" : ""}{Number(change).toFixed(1).replace(/\.0$/, "")}
        </span>
      ) : (
        <Minus className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
      )}
      <span className="block text-[10px] text-muted-foreground">since last eval</span>
    </div>
  );
};

/* One stat block inside the team snapshot band — tinted icon square + value. */
const SnapshotStat = ({ icon: Icon, tint, label, value, sub, testId }) => (
  <div className="flex items-center gap-3 rounded-xl px-3 py-2" data-testid={testId}>
    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", tint)}>
      <Icon className="h-4 w-4" />
    </span>
    <span className="min-w-0">
      <span className="block font-mono-num text-2xl font-bold leading-tight text-foreground">{value ?? "–"}</span>
      <span className="block text-[11px] font-semibold text-muted-foreground whitespace-nowrap">{label}</span>
      {sub}
    </span>
  </div>
);

export default function TeamDetail() {
  const { teamName } = useParams();
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
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}
        </div>
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
  const total = summary.athlete_count ?? athletes.length;
  const evaluated = athletes.filter((a) => a.statuses?.evaluated).length;
  const improving = summary.improving ?? athletes.filter((a) => Number(a.score_change) > 0).length;
  const declining = athletes.filter((a) => Number(a.score_change) < 0).length;
  const followUp = summary.follow_up ?? athletes.filter((a) => a.statuses?.follow_up).length;
  const hasAvg = summary.avg_score !== null && summary.avg_score !== undefined && summary.avg_score !== "";
  const focuses = [...new Set(athletes.map((a) => a.development_focus).filter(Boolean))];

  return (
    <div className="space-y-4" data-testid="team-detail">
      <Link to="/teams" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground" data-testid="team-detail-back-link">
        <ArrowLeft className="h-3.5 w-3.5" /> Teams
      </Link>

      {/* Header — monogram + team identity */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-brand-tertiary via-secondary to-background">
          <span className="select-none font-display text-2xl text-brand/70">{teamInitials(summary.team || displayName)}</span>
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-4xl text-foreground">{summary.team || displayName}</h1>
          <p className="text-sm text-muted-foreground">
            Team Overview · {total} athlete{total === 1 ? "" : "s"} on this team
          </p>
        </div>
      </div>

      {/* Snapshot band — roster count + development at a glance, from data
          already fetched. Avg score renders only when a scored eval exists. */}
      <div className="rounded-2xl border border-border bg-card px-4 py-4 sm:px-6" data-testid="team-detail-snapshot">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <div className="min-w-[100px]">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Roster</p>
            <p className="font-display text-4xl leading-none text-foreground">{total}</p>
            <p className="mt-1 text-xs text-muted-foreground">athlete{total === 1 ? "" : "s"}</p>
          </div>
          <div className="hidden md:block w-px self-stretch bg-border" />
          <SnapshotStat
            icon={ClipboardCheck}
            tint="bg-success/15 text-success"
            label="Evaluated"
            value={evaluated}
            sub={<span className="block font-mono-num text-[10px] font-semibold text-success">{pct(evaluated, total)}%</span>}
            testId="team-detail-snapshot-evaluated"
          />
          <SnapshotStat
            icon={TrendingUp}
            tint="bg-success/15 text-success"
            label="Improving"
            value={improving}
            sub={
              <span className="block font-mono-num text-[10px] font-semibold text-success">
                {pct(improving, total)}%{declining > 0 ? <span className="text-muted-foreground"> · {declining} down</span> : null}
              </span>
            }
            testId="team-detail-snapshot-improving"
          />
          <SnapshotStat
            icon={AlertTriangle}
            tint="bg-warning/15 text-warning"
            label="Need Follow-Up"
            value={followUp}
            sub={<span className="block font-mono-num text-[10px] font-semibold text-warning">{pct(followUp, total)}%</span>}
            testId="team-detail-snapshot-follow-up"
          />
          <Link to="/development" className="rounded-xl transition-colors hover:bg-secondary" data-testid="team-detail-goals-link">
            <SnapshotStat
              icon={Target}
              tint="bg-brand/15 text-brand"
              label="Active Goals"
              value={summary.active_goals ?? "–"}
              sub={<span className="block text-[10px] font-semibold text-muted-foreground">View development →</span>}
            />
          </Link>
          <div className="ml-auto" data-testid="team-detail-snapshot-avg">
            {hasAvg ? (
              <div className="flex items-center gap-3 rounded-xl px-3 py-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success">
                  <BarChart3 className="h-4 w-4" />
                </span>
                <span>
                  <span className="block rounded-lg bg-success px-2.5 py-1 font-mono-num text-lg font-bold leading-none text-white">
                    {fmtScore(summary.avg_score)}
                  </span>
                  <span className="mt-1 block text-[11px] font-semibold text-muted-foreground">Team Avg</span>
                </span>
              </div>
            ) : (
              <p className="max-w-[160px] text-xs text-muted-foreground">No scored evaluations yet.</p>
            )}
          </div>
        </div>

        {(gradYears.length > 0 || focuses.length > 0) && (
          <div className="mt-4 space-y-2 border-t border-border pt-3">
            {gradYears.length > 0 && (
              <div className="flex flex-wrap items-center gap-2" data-testid="team-detail-gradyear-chips">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Classes</span>
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
            {focuses.length > 0 && (
              <div className="flex flex-wrap items-center gap-2" data-testid="team-detail-focus-areas">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Focus areas</span>
                {focuses.slice(0, 6).map((f) => (
                  <span key={f} className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-foreground">
                    {f}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Roster — photo-forward scouting cards (PlayersList pattern) */}
      <div className="space-y-2">
        <div className="flex items-center gap-2.5">
          <h2 className="font-display text-2xl text-foreground">Roster</h2>
          <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-mono-num font-bold text-muted-foreground">
            {athletes.length}
          </span>
        </div>
        {athletes.length === 0 ? (
          <EmptyState icon={Users} title="No athletes" hint="Athletes appear here once they have this team set on their profile." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3" data-testid="team-roster">
            {athletes.map((a) => {
              const hasScore = a.latest_overall !== null && a.latest_overall !== undefined;
              return (
                <Link key={a.id} to={`/players/${a.id}`} className="block h-full" data-testid={`team-roster-row-${a.id}`}>
                  <Card className="h-full overflow-hidden rounded-2xl border-border transition-all hover:border-brand/50 hover:shadow-lg hover:-translate-y-0.5">
                    <div className="relative aspect-[4/3] w-full overflow-hidden">
                      <CardPhoto p={a} />
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/55 to-transparent" />
                      <div className="absolute left-2.5 top-2.5">
                        <CardStatusPill statuses={a.statuses} />
                      </div>
                      {hasScore && (
                        <span className="absolute bottom-2.5 left-2.5 rounded-lg bg-success px-2.5 py-1.5 font-mono-num text-xl font-bold leading-none text-white shadow-lg">
                          {fmtScore(a.latest_overall)}
                        </span>
                      )}
                    </div>
                    <CardContent className="p-4 pt-3 space-y-2.5">
                      <div className="min-w-0">
                        <p className="font-display text-lg leading-tight text-foreground truncate">{a.first_name} {a.last_name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {a.primary_position || "—"} · {a.bats || "—"}/{a.throws || "—"}
                        </p>
                        {(a.graduation_year || a.age_group) && (
                          <p className="text-xs text-muted-foreground truncate">
                            {[a.graduation_year ? `Class of ${a.graduation_year}` : null, a.age_group || null].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </div>
                      {hasScore ? (
                        /* The score itself sits on the photo — this row carries the trend. */
                        <div className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl bg-secondary px-3 py-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wide leading-tight text-muted-foreground">
                            Overall Eval Score
                          </span>
                          <ChangeSince change={a.score_change} />
                        </div>
                      ) : a.statuses?.evaluated ? (
                        /* Evaluated, but the evals carry raw measurements only —
                           no normalized overall. Don't contradict the pill. */
                        <div className="flex min-h-[44px] items-center justify-between gap-2 rounded-xl bg-secondary px-3 py-2">
                          <span className="text-xs text-muted-foreground">Evaluated · metrics on file</span>
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-info">View profile →</span>
                        </div>
                      ) : (
                        <div className="flex min-h-[44px] items-center rounded-xl bg-secondary px-3 py-2">
                          <span className="text-xs text-muted-foreground">No eval yet · Not Evaluated</span>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Focus</p>
                          <p className="text-xs text-foreground truncate" title={a.development_focus || undefined}>{a.development_focus || "—"}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Last Eval</p>
                          <p className="text-xs text-foreground truncate">{fmtDate(a.last_eval_at)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
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
                  {ev.overall_score !== null && ev.overall_score !== undefined ? (
                    <span className="rounded-lg bg-success/15 px-2 py-0.5 font-mono-num font-bold text-success shrink-0">
                      {fmtScore(ev.overall_score)}
                    </span>
                  ) : (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground shrink-0">
                      Metrics recorded
                    </span>
                  )}
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
