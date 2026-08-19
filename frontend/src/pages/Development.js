import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ChevronRight, StickyNote, Target, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/* Bar fills cycle per goal card so the progress column reads as a scannable
   band. The track is always bg-secondary; the width is the goal's real
   percentage — goals without one get a badge, never a fake bar. */
const BAR_FILLS = ["bg-success", "bg-warning", "bg-info"];

const hasPct = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));
const clampPct = (v) => Math.min(100, Math.max(0, Number(v)));

const StatCard = ({ icon: Icon, tint, value, label, sub, testId }) => (
  <Card className="rounded-2xl border-border bg-card h-full" data-testid={testId}>
    <CardContent className="pt-4 pb-4 flex items-center gap-3">
      <div className={cn("h-10 w-10 rounded-lg grid place-items-center shrink-0", tint)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="font-mono-num font-bold text-2xl text-foreground leading-none">{value ?? "—"}</p>
        <p className="mt-1 text-xs font-semibold leading-snug text-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground truncate">{sub}</p>}
      </div>
    </CardContent>
  </Card>
);

const SectionLabel = ({ children, count }) => (
  <div className="flex items-center gap-2">
    <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</h2>
    {count !== null && count !== undefined && (
      <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-mono-num font-bold text-muted-foreground">{count}</span>
    )}
  </div>
);

export default function Development() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/development/overview").then((r) => setData(r.data)).catch(() => setData({ goals: [], recent_assessments: [] }));
  }, []);

  // Everything on this band is counted from the payload already on screen —
  // no derived scores, no invented percentages.
  const stats = useMemo(() => {
    if (!data) return null;
    const goals = data.goals || [];
    const assessments = data.recent_assessments || [];
    const withPct = goals.filter((g) => hasPct(g.progress));
    return {
      goals: goals.length,
      athletes: new Set(goals.map((g) => g.athlete_id)).size,
      followUps: goals.filter((g) => g.follow_up_date).length + assessments.filter((n) => n.follow_up_date).length,
      assessments: assessments.length,
      avgProgress: withPct.length > 0
        ? Math.round(withPct.reduce((s, g) => s + Number(g.progress), 0) / withPct.length)
        : null,
    };
  }, [data]);

  if (!data) return <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-4xl text-foreground">Development</h1>
        <p className="text-sm text-muted-foreground">Active goals and recent coach assessments across the program.</p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-2" data-testid="development-stat-row">
          <StatCard
            icon={Target}
            tint="bg-brand/15 text-brand"
            value={stats.goals}
            label="Active goals"
            sub={stats.avgProgress !== null ? `${stats.avgProgress}% avg progress` : "Across the program"}
            testId="development-stat-goals"
          />
          <StatCard
            icon={Users}
            tint="bg-info/15 text-info"
            value={stats.athletes}
            label="Athletes"
            sub="With active goals"
            testId="development-stat-athletes"
          />
          <StatCard
            icon={AlertTriangle}
            tint="bg-warning/15 text-warning"
            value={stats.followUps}
            label="Follow-ups"
            sub="Scheduled on goals & notes"
            testId="development-stat-follow-ups"
          />
          <StatCard
            icon={StickyNote}
            tint="bg-success/15 text-success"
            value={stats.assessments}
            label="Assessments"
            sub="Year to date"
            testId="development-stat-assessments"
          />
        </div>
      )}

      <section className="space-y-2">
        <SectionLabel count={data.goals.length}>Active goals</SectionLabel>
        {data.goals.length === 0 ? (
          <EmptyState icon={Target} title="No active goals" hint="Create development goals from any player profile." />
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {data.goals.map((g, i) => (
              <Card key={g.id} className="rounded-2xl border-border" data-testid={`development-goal-${g.id}`}>
                <CardContent className="py-4">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/players/${g.athlete_id}?tab=development`}
                      className="flex flex-1 min-w-0 items-center gap-3 rounded-lg -mx-2 px-2 py-1.5 transition-colors hover:bg-secondary"
                    >
                      <PlayerAvatar firstName={g.athlete?.first_name} lastName={g.athlete?.last_name} photoUrl={g.athlete?.photo_url} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {g.athlete ? `${g.athlete.first_name} ${g.athlete.last_name}` : "Player"}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{g.title}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </Link>
                    <StatusBadge status={g.status} />
                  </div>
                  {g.description && <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{g.description}</p>}
                  {(g.recommended_action || g.recommended_drills) && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      <span className="text-foreground/70 font-medium">Action:</span> {g.recommended_action || g.recommended_drills}
                    </p>
                  )}
                  {hasPct(g.progress) ? (
                    <div className="mt-3 flex items-center gap-3">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div
                          className={cn("h-full rounded-full", BAR_FILLS[i % BAR_FILLS.length])}
                          style={{ width: `${clampPct(g.progress)}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono-num font-semibold text-foreground shrink-0">{clampPct(g.progress)}%</span>
                    </div>
                  ) : (
                    <span className="mt-3 inline-block rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                      No progress logged yet
                    </span>
                  )}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {g.assigned_coach_name && <span>Coach: {g.assigned_coach_name}</span>}
                    {g.start_date && <span>Start: {g.start_date}</span>}
                    {g.target_date && <span>Target: {g.target_date}</span>}
                    {g.follow_up_date && <span>Follow-up: {g.follow_up_date}</span>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <SectionLabel count={data.recent_assessments.length}>Recent assessments</SectionLabel>
        {data.recent_assessments.length === 0 ? (
          <EmptyState icon={StickyNote} title="No assessments yet" hint="Year-to-date coach assessments appear here." />
        ) : (
          <div className="space-y-2">
            {data.recent_assessments.map((n) => (
              <Link key={n.id} to={`/players/${n.athlete_id}?tab=notes`} className="block" data-testid={`development-assessment-${n.id}`}>
                <Card className="rounded-2xl border-border transition-colors hover:bg-secondary/50">
                  <CardContent className="py-3.5 flex items-center gap-3">
                    <PlayerAvatar firstName={n.athlete?.first_name} lastName={n.athlete?.last_name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {n.athlete ? `${n.athlete.first_name} ${n.athlete.last_name}` : "Player"}
                        </p>
                        <span className="text-xs text-muted-foreground shrink-0">{n.assessment_date}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{n.assessment_type} · {n.author_name}</p>
                      {n.strengths && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{n.strengths}</p>}
                      {(n.related_event_name || n.follow_up_date) && (
                        <p className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3">
                          {n.related_event_name && <span>Event: {n.related_event_name}</span>}
                          {n.follow_up_date && <span>Follow-up: {n.follow_up_date}</span>}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
