import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useWorkspace, getActiveWorkspace, resolveOrgLogoSrc } from "@/components/layout/AppLayout";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { EmptyState } from "@/components/common/EmptyState";
import {
  CalendarPlus, Upload, UserCog, ClipboardCheck, ArrowRight, Users,
  CheckCircle2, ClipboardList, Flag, Activity, CalendarDays, Trophy, FileDown,
  TrendingUp, TrendingDown, Minus, GraduationCap, Target, UsersRound, ChevronRight,
} from "lucide-react";
import { signedUrl } from "@/lib/api";

const StatCard = ({ label, value, icon: Icon, tint = "bg-secondary text-foreground", testId, to, sub }) => {
  const card = (
    <Card className={`rounded-2xl border-border bg-card h-full ${to ? "cursor-pointer transition-colors hover:bg-secondary/50" : ""}`} data-testid={testId}>
      <CardContent className="pt-4 pb-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className={`h-10 w-10 rounded-lg grid place-items-center shrink-0 ${tint}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="font-mono-num font-bold text-2xl text-foreground leading-none">{value ?? "—"}</p>
          {/* Labels wrap (max 2 lines) instead of truncating — "Registered
              Players" must never render as "Regi…" in a narrow column. */}
          <p className="mt-1 text-xs font-semibold leading-snug text-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">{label}</p>
          {sub && <p className="text-[10px] text-muted-foreground truncate">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
  if (to) return <Link to={to} className="block h-full">{card}</Link>;
  return card;
};

const PanelLabel = ({ children }) => (
  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>
);

const shortDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const QuickAction = ({ to, onClick, icon: Icon, label, testId }) => {
  const inner = (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3.5 hover:bg-secondary transition-colors active:scale-[0.98] cursor-pointer">
      <Icon className="h-5 w-5 text-foreground" />
      <span className="text-sm font-semibold text-foreground flex-1">{label}</span>
      <ArrowRight className="h-4 w-4 text-muted-foreground" />
    </div>
  );
  if (to) return <Link to={to} data-testid={testId}>{inner}</Link>;
  return <button onClick={onClick} data-testid={testId} className="w-full text-left">{inner}</button>;
};

/** Development-first pulse strip: improving / declining / holding, with arrows. */
const DevTrendStrip = ({ trend, testId }) => {
  if (!trend) return null;
  return (
    <Card className="rounded-2xl border-border" data-testid={testId}>
      <CardContent className="pt-4 pb-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Development</p>
        <span className="flex items-center gap-1.5 text-sm font-semibold text-success font-mono-num">
          <TrendingUp className="h-4 w-4" /> {trend.improving ?? 0} improving
        </span>
        <span className="flex items-center gap-1.5 text-sm font-semibold text-destructive font-mono-num">
          <TrendingDown className="h-4 w-4" /> {trend.declining ?? 0} declining
        </span>
        <span className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground font-mono-num">
          <Minus className="h-4 w-4" /> {trend.flat ?? 0} holding
        </span>
        <Link to="/development" className="ml-auto text-xs text-info hover:underline">Open Progress</Link>
      </CardContent>
    </Card>
  );
};

/** HQ header variant of the development pulse: compact inline chips, no card. */
const DevTrendChips = ({ trend, testId }) => {
  if (!trend) return null;
  const chip = "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold font-mono-num";
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={testId}>
      <span className={`${chip} text-success`}>
        <TrendingUp className="h-3.5 w-3.5" /> {trend.improving ?? 0} improving
      </span>
      <span className={`${chip} text-warning`}>
        <TrendingDown className="h-3.5 w-3.5" /> {trend.declining ?? 0} declining
      </span>
      <span className={`${chip} text-muted-foreground`}>
        <Minus className="h-3.5 w-3.5" /> {trend.flat ?? 0} holding
      </span>
      <Link to="/development" className="text-xs text-info hover:underline">Open Progress</Link>
    </div>
  );
};

const fmtChange = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  const s = abs >= 10 ? Math.round(abs) : abs.toFixed(1).replace(/\.0$/, "");
  return `${n >= 0 ? "+" : "-"}${s}`;
};

/** Verified vs in-review donut — pure SVG, same circle/strokeDasharray pattern as ReviewQueue. */
const StatusDonut = ({ totals }) => {
  const total = totals?.evaluations || 0;
  const verified = Math.min(totals?.verified || 0, total);
  const inReview = total - verified;
  const C = 2 * Math.PI * 46;
  const vLen = total > 0 ? (verified / total) * C : 0;
  return (
    <div className="flex flex-wrap items-center gap-4" data-testid="hq-status-donut">
      <svg viewBox="0 0 120 120" className="h-32 w-32 shrink-0" role="img" aria-label="Evaluations by status">
        <circle cx="60" cy="60" r="46" fill="none" stroke="hsl(var(--secondary))" strokeWidth="14" />
        {total > 0 && (
          <g transform="rotate(-90 60 60)">
            <circle cx="60" cy="60" r="46" fill="none" stroke="hsl(var(--warning))" strokeWidth="14" strokeDasharray={`${C - vLen} ${vLen}`} strokeDashoffset={-vLen} />
            {vLen > 0 && (
              <circle cx="60" cy="60" r="46" fill="none" stroke="hsl(var(--success))" strokeWidth="14" strokeDasharray={`${vLen} ${C - vLen}`} />
            )}
          </g>
        )}
        <text x="60" y="62" textAnchor="middle" className="font-mono-num" fontSize="24" fontWeight="700" fill="hsl(var(--foreground))">{total}</text>
        <text x="60" y="78" textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))">Total</text>
      </svg>
      <div className="flex-1 min-w-[140px] space-y-1.5">
        <div className="flex items-center gap-2 text-xs">
          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: "hsl(var(--success))" }} />
          <span className="flex-1 truncate text-foreground">Verified</span>
          <span className="font-mono-num text-muted-foreground shrink-0">{verified}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: "hsl(var(--warning))" }} />
          <span className="flex-1 truncate text-foreground">In review / submitted</span>
          <span className="font-mono-num text-muted-foreground shrink-0">{inReview}</span>
        </div>
      </div>
    </div>
  );
};

const HqTopPerformers = ({ performers }) => {
  const scored = (performers || []).filter((p) => p.latest_overall !== null && p.latest_overall !== undefined).slice(0, 5);
  return (
    <div data-testid="hq-top-performers">
      <PanelLabel>Top performers</PanelLabel>
      {scored.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No scored evaluations yet.</p>
      ) : (
        <div className="mt-2 space-y-1">
          {scored.map((p, i) => {
            const sub = [
              p.primary_position || "—",
              p.graduation_year ? `Class of ${p.graduation_year}` : (p.age_group || ""),
            ].filter(Boolean).join(" · ");
            return (
              <Link
                key={p.id ?? p.athlete_id ?? i}
                to={`/players/${p.athlete_id}`}
                className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-secondary transition-colors"
                data-testid={`hq-top-performer-${i}`}
              >
                <span className={`w-5 text-center font-mono-num font-bold text-sm shrink-0 ${i === 0 ? "text-primary" : "text-muted-foreground"}`}>{i + 1}</span>
                <PlayerAvatar firstName={p.first_name} lastName={p.last_name} photoUrl={p.photo_url} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{p.first_name} {p.last_name}</p>
                  <p className="text-xs text-muted-foreground truncate">{sub}</p>
                </div>
                <span className="rounded-lg bg-success/15 px-2 py-0.5 font-mono-num font-bold text-success shrink-0">{p.latest_overall}</span>
              </Link>
            );
          })}
        </div>
      )}
      <Link to="/review" className="mt-2 inline-block text-xs font-semibold text-primary hover:underline">Open review desk →</Link>
    </div>
  );
};

const HqRecentEvalCard = ({ r }) => {
  const a = r.athlete;
  const sub = [
    a?.graduation_year,
    a?.primary_position || "—",
  ].filter(Boolean).join(" · ");
  return (
    <Link
      to={`/evaluation/${r.id}/results`}
      data-testid={`hq-recent-${r.id}`}
      className="min-w-[240px] max-w-[260px] shrink-0 snap-start rounded-2xl border border-border bg-card p-4 hover:bg-secondary/50 transition-colors flex flex-col gap-3"
    >
      <div className="flex items-center gap-3">
        <PlayerAvatar firstName={a?.first_name} lastName={a?.last_name} photoUrl={a?.photo_url} size="sm" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{a ? `${a.first_name} ${a.last_name}` : "Athlete"}</p>
          <p className="text-[11px] text-muted-foreground truncate">{sub}</p>
        </div>
      </div>
      <div className="text-center">
        {r.overall_score !== null && r.overall_score !== undefined ? (
          <span className="inline-block rounded-xl bg-success/15 px-3 py-1 font-mono-num text-2xl font-bold text-success">{r.overall_score}</span>
        ) : (
          <span className="inline-block rounded-xl bg-secondary px-3 py-1.5 text-xs font-semibold text-muted-foreground">Metrics recorded</span>
        )}
        {r.station_name && <p className="text-[10px] text-muted-foreground mt-1 truncate">{r.station_name}</p>}
      </div>
      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <CalendarDays className="h-3 w-3" /> {shortDate(r.submitted_at)}
        </span>
        {r.status === "approved" ? (
          <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">Verified</span>
        ) : (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning">Pending</span>
        )}
      </div>
    </Link>
  );
};

export default function Dashboard() {
  const { user } = useAuth();
  // The dashboard renders by ACTIVE WORKSPACE (a lens, not an access grant):
  // an owner in the "coach" workspace sees the Coach Hub dashboard (data stays
  // org-wide), in "evaluator" the evaluator dashboard (honestly empty unless
  // they hold assignments). Unauthorized stored values fall back to the first
  // authorized workspace inside getActiveWorkspace.
  const wsCtx = useWorkspace();
  const workspace = wsCtx?.workspace || getActiveWorkspace(user);
  const [data, setData] = useState(null);
  const [insights, setInsights] = useState(null);
  const [orgSummary, setOrgSummary] = useState(null);
  const [devOverview, setDevOverview] = useState(null);
  // HQ-only evaluation analytics (/evaluations/insights). Non-review roles get a
  // 403 — soft() maps that to null and the snapshot/rail sections simply hide.
  const [evalInsights, setEvalInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    setLoading(true); // re-entered on workspace switch — don't show stale lens
    const soft = (path) => api.get(path).then((res) => res.data).catch(() => null);
    Promise.all([
      soft("/dashboard"),
      ["scout", "coach"].includes(workspace) ? soft("/reports/insights") : Promise.resolve(null),
      workspace === "hq" ? soft("/organizations/summary") : Promise.resolve(null),
      workspace === "coach" ? soft("/development/overview") : Promise.resolve(null),
      workspace === "hq" ? soft("/evaluations/insights") : Promise.resolve(null),
    ]).then(([d, ins, org, dev, evalIns]) => {
      if (!alive) return;
      setData(d);
      setInsights(ins);
      setOrgSummary(org);
      setDevOverview(dev);
      setEvalInsights(evalIns);
    }).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [user?.role, workspace]);

  if (loading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-56" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );

  const role = data?.role || user?.role;

  // -------- EVALUATION MODE workspace: assignments only, zero distraction --------
  if (workspace === "evaluator") {
    const assignments = data?.assignments || [];
    const remaining = assignments.reduce((sum, a) => sum + (a.remaining ?? Math.max(0, (a.expected || 0) - (a.completed || 0))), 0);
    return (
      <div className="space-y-5" data-testid="evaluator-dashboard">
        <div>
          <h1 className="font-display text-4xl text-foreground">My Evaluations</h1>
          <p className="text-sm text-muted-foreground">
            Welcome back, {user?.full_name?.split(" ")[0]}.{" "}
            {assignments.length > 0 && (
              <span className="font-semibold text-foreground font-mono-num">
                {remaining} evaluation{remaining === 1 ? "" : "s"} remaining
              </span>
            )}
          </p>
        </div>
        {assignments.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="No assignments yet" hint="Your administrator will assign you to an event station. Check back soon." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {assignments.map((a) => {
              const left = a.remaining ?? Math.max(0, (a.expected || 0) - (a.completed || 0));
              return (
                <Card key={a.assignment_id} className="rounded-2xl border-border overflow-hidden">
                  <div className="bg-primary px-5 py-3 flex items-center justify-between">
                    <p className="text-white font-semibold text-sm truncate">{a.event?.name}</p>
                    <StatusBadge status={a.event?.status} />
                  </div>
                  <CardContent className="pt-4 pb-5 space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">My Station</p>
                        <p className="font-semibold text-foreground">{a.station_name}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">My Groups</p>
                        <p className="font-semibold text-foreground truncate">{(a.group_names || []).join(", ") || "All groups"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-success transition-all" style={{ width: `${a.expected ? Math.round((a.completed / a.expected) * 100) : 0}%` }} />
                      </div>
                      <p className="text-xs font-mono-num text-muted-foreground whitespace-nowrap">
                        {a.completed}/{a.expected} done · <span className="font-bold text-foreground">{left} left</span>
                      </p>
                    </div>
                    {a.last_saved && <p className="text-xs text-muted-foreground">Last saved: {new Date(a.last_saved).toLocaleString()}</p>}
                    <Button
                      className="w-full h-12 rounded-xl bg-primary hover:bg-brand-secondary text-base font-semibold active:scale-[0.98]"
                      onClick={() => navigate(`/evaluate/${a.assignment_id}`)}
                      data-testid={`continue-evaluating-${a.assignment_id}`}
                    >
                      {a.completed > 0 ? "Continue Evaluating" : "Start Evaluating"}
                      <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // -------- SCOUT MODE workspace — review-first --------
  if (workspace === "scout") {
    const awaiting = insights?.needs_review ?? data?.awaiting_review;
    const flagged = insights?.flagged ?? data?.flagged_players;
    const movers = (insights?.top_movers || []).slice(0, 5);
    return (
      <div className="space-y-5" data-testid="head-scout-dashboard">
        <div>
          <h1 className="font-display text-4xl text-foreground">Review Desk</h1>
          <p className="text-sm text-muted-foreground">Approve evaluations and track who&apos;s developing.</p>
        </div>

        {/* Hero: the review queue is the job */}
        <Card className="rounded-2xl border-border overflow-hidden" data-testid="stat-awaiting-review">
          <CardContent className="hero-sweep pt-5 pb-5 flex flex-wrap items-center gap-4">
            <div className="h-14 w-14 rounded-2xl flex items-center justify-center shrink-0" style={{ backgroundColor: "hsl(var(--warning) / 0.12)" }}>
              <ClipboardList className="h-7 w-7 text-warning" />
            </div>
            <div className="flex-1 min-w-[140px]">
              <p className="text-4xl font-bold text-foreground leading-none font-mono-num">
                {awaiting ?? <span className="inline-block h-7 w-10 align-middle rounded bg-secondary animate-pulse" aria-label="Loading" />}
              </p>
              <p className="text-sm text-muted-foreground mt-1.5">Evaluations awaiting your review</p>
            </div>
            <Button onClick={() => navigate("/review")} className="h-12 rounded-xl bg-primary hover:bg-brand-secondary px-6" data-testid="open-review-queue-button">
              Open Review Queue <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </CardContent>
        </Card>

        <DevTrendStrip trend={insights?.development_trend} testId="dev-trend-strip" />

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <StatCard label="Approved" value={data?.approved} icon={CheckCircle2} tint="bg-success/15 text-success" testId="stat-approved" />
          <StatCard label="Flagged for Follow-Up" value={flagged} icon={Flag} tint="bg-destructive/15 text-destructive" testId="stat-flagged" to="/players?flagged=true" />
          {insights?.evaluations && (
            <StatCard label="Evaluations Completed" value={`${insights.evaluations.completed ?? 0}/${insights.evaluations.expected ?? 0}`} icon={ClipboardCheck} tint="bg-info/15 text-info" testId="stat-evals-progress" />
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="rounded-2xl border-border">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  {movers.length > 0 ? <TrendingUp className="h-4 w-4 text-success" /> : <Trophy className="h-4 w-4 text-warning" />}
                  {movers.length > 0 ? "Top Movers" : "Top Players"}
                </span>
                <Link to="/reports" className="text-xs text-info hover:underline font-normal">View leaderboard</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {movers.length > 0 ? (
                movers.map((m, i) => {
                  const up = Number(m.change) >= 0;
                  return (
                    <Link key={m.athlete?.id || i} to={`/players/${m.athlete?.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-secondary transition-colors" data-testid={`top-mover-${i}`}>
                      <PlayerAvatar firstName={m.athlete?.first_name} lastName={m.athlete?.last_name} photoUrl={m.athlete?.photo_url} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{m.athlete?.first_name} {m.athlete?.last_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {m.athlete?.primary_position}{m.athlete?.graduation_year ? ` · Class of ${m.athlete.graduation_year}` : ""}
                        </p>
                      </div>
                      {fmtChange(m.change) && (
                        <span className={`flex items-center gap-0.5 text-xs font-bold font-mono-num ${up ? "text-success" : "text-destructive"}`}>
                          {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                          {fmtChange(m.change)}
                        </span>
                      )}
                      <span className="font-mono-num font-bold text-foreground">{m.current_score}</span>
                    </Link>
                  );
                })
              ) : (
                <>
                  {(data?.top_players || []).length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No scored evaluations yet.</p>}
                  {(data?.top_players || []).map((p, i) => (
                    <Link key={p.athlete.id} to={`/players/${p.athlete.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-secondary transition-colors" data-testid={`top-player-${i}`}>
                      <span className="font-display text-xl text-warning w-6 text-center">{i + 1}</span>
                      <PlayerAvatar firstName={p.athlete.first_name} lastName={p.athlete.last_name} photoUrl={p.athlete.photo_url} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{p.athlete.first_name} {p.athlete.last_name}</p>
                        <p className="text-xs text-muted-foreground">{p.athlete.age_group} · {p.athlete.primary_position}</p>
                      </div>
                      <span className="font-mono-num font-bold text-foreground">{p.overall_score}</span>
                    </Link>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-border">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span>Recent Staff Notes</span>
                <Link to="/review" className="text-xs text-info hover:underline font-normal">Open review queue</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(data?.recent_notes || []).length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No notes yet.</p>}
              {(data?.recent_notes || []).map((n) => (
                <div key={n.id} className="rounded-xl border px-3.5 py-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">{n.athlete_name}</p>
                    <span className="text-[11px] text-muted-foreground">{(n.created_at || "").slice(0, 10)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.summary || n.strengths || n.assessment_type}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">{n.author_name}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // -------- COACH HUB workspace — "My Athletes": today's work first --------
  if (workspace === "coach") {
    const ev = data?.upcoming_event;
    const stats = data?.event_stats || {};
    const goals = devOverview?.goals || [];
    const activeGoals = goals.filter((g) => (g.status || "").toLowerCase() !== "completed");
    const athleteGoals = [];
    const seen = new Set();
    for (const g of activeGoals) {
      if (!g.athlete || seen.has(g.athlete_id)) continue;
      seen.add(g.athlete_id);
      athleteGoals.push(g);
      if (athleteGoals.length >= 6) break;
    }
    const assessments = (devOverview?.recent_assessments || []).slice(0, 4);
    return (
      <div className="space-y-5" data-testid="coach-dashboard">
        <div>
          <h1 className="font-display text-4xl text-foreground">My Athletes</h1>
          <p className="text-sm text-muted-foreground">Welcome back, {user?.full_name?.split(" ")[0]}. Here&apos;s today&apos;s work.</p>
        </div>

        <DevTrendStrip trend={insights?.development_trend} testId="dev-trend-strip" />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Active Goals" value={devOverview ? activeGoals.length : undefined} icon={Target} tint="bg-success/15 text-success" testId="stat-active-goals" to="/development" />
          <StatCard label="My Athletes" value={data?.total_players} icon={Users} tint="bg-brand/15 text-brand" testId="stat-total-athletes" to="/players" />
          <StatCard
            label="Evaluations"
            value={insights?.evaluations ? `${insights.evaluations.completed ?? 0}/${insights.evaluations.expected ?? 0}` : stats.evaluations_completed}
            icon={ClipboardCheck} tint="bg-info/15 text-info" testId="stat-evals-completed"
          />
          <StatCard label="Checked In" value={stats.checked_in} icon={CheckCircle2} tint="bg-success/15 text-success" testId="stat-checked-in" />
        </div>

        {ev ? (
          <Card className="rounded-2xl border-border overflow-hidden">
            <div className="hero-sweep px-5 py-4 border-b flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Upcoming / Active Event</p>
                <Link to={`/events/${ev.id}`} className="block font-display text-2xl leading-tight text-foreground break-words hover:underline" data-testid="dashboard-event-link">{ev.name}</Link>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><CalendarDays className="h-3.5 w-3.5" /> {ev.date} · {ev.location}</p>
              </div>
              <StatusBadge status={ev.status} testId="event-status-badge" />
            </div>
            <CardContent className="pt-4 pb-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <QuickAction to={`/events/${ev.id}`} icon={CalendarDays} label="Open Event" testId="quick-action-open-event" />
                <QuickAction to="/development" icon={TrendingUp} label="Log Development Note" testId="quick-action-log-development" />
              </div>
            </CardContent>
          </Card>
        ) : (
          <EmptyState icon={CalendarDays} title="No events yet" hint="Your next event will appear here once it's scheduled." />
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="rounded-2xl border-border">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2"><Target className="h-4 w-4 text-success" /> Athletes with Active Goals</span>
                <Link to="/development" className="text-xs text-info hover:underline font-normal">Open Progress</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {athleteGoals.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {devOverview ? "No active development goals yet." : "Development goals will appear here."}
                </p>
              )}
              {athleteGoals.map((g, i) => (
                <Link key={g.athlete_id} to={`/players/${g.athlete_id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-secondary transition-colors" data-testid={`goal-athlete-${i}`}>
                  <PlayerAvatar firstName={g.athlete?.first_name} lastName={g.athlete?.last_name} photoUrl={g.athlete?.photo_url} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{g.athlete?.first_name} {g.athlete?.last_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{g.title || g.goal || g.description || "Development goal"}</p>
                  </div>
                  {g.status && <StatusBadge status={g.status} />}
                </Link>
              ))}
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-border">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span>{assessments.length > 0 ? "Recent Assessments" : "Recently Added Players"}</span>
                <Link to="/players" className="text-xs text-info hover:underline font-normal">View all ({data?.total_players})</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {assessments.length > 0 ? (
                assessments.map((n) => (
                  <Link key={n.id} to={`/players/${n.athlete_id}`} className="block rounded-xl border px-3.5 py-2.5 hover:bg-secondary transition-colors">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-foreground">{n.athlete ? `${n.athlete.first_name} ${n.athlete.last_name}` : "Athlete"}</p>
                      <span className="text-[11px] text-muted-foreground">{(n.created_at || "").slice(0, 10)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.summary || n.strengths || n.content || n.note_type}</p>
                  </Link>
                ))
              ) : (
                (data?.recent_players || []).map((p) => (
                  <Link key={p.id} to={`/players/${p.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-secondary transition-colors">
                    <PlayerAvatar firstName={p.first_name} lastName={p.last_name} photoUrl={p.photo_url} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{p.first_name} {p.last_name}</p>
                      <p className="text-xs text-muted-foreground">{p.age_group} · {p.primary_position}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // -------- HQ workspace (owner/admin) — Organization HQ --------
  const ev = data?.upcoming_event;
  const stats = data?.event_stats || {};
  const isAdmin = role === "owner" || role === "admin";
  const org = orgSummary?.organization;
  const orgName = org?.name || user?.organization_name;
  const gradClasses = (orgSummary?.grad_classes || []).filter((g) => g?.year);
  return (
    <div className="space-y-5" data-testid="admin-dashboard">
      {/* Chips sit beside the identity block on desktop and drop below it on
          mobile — never overlapping the welcome line. */}
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        {org?.logo_url ? (
          // Uploaded logos live behind the authenticated /organization/logo route.
          <img src={resolveOrgLogoSrc(org.logo_url)} alt={orgName} className="h-12 w-12 rounded-xl object-cover ring-1 ring-border shrink-0" data-testid="org-hq-logo" />
        ) : (
          <div className="h-12 w-12 rounded-xl bg-brand-tertiary ring-1 ring-brand/40 flex items-center justify-center shrink-0" data-testid="org-hq-logo">
            <span className="font-display text-lg font-extrabold text-brand leading-none">{(orgName || "HQ").charAt(0)}</span>
          </div>
        )}
        <div className="min-w-0 flex-1 basis-[min(100%,16rem)]">
          <PanelLabel>Organization HQ</PanelLabel>
          <h1 className="font-display text-3xl sm:text-4xl text-foreground truncate" data-testid="org-hq-name">{orgName || "Dashboard"}</h1>
          <p className="text-sm text-muted-foreground truncate">Welcome back, {user?.full_name?.split(" ")[0]}.</p>
        </div>
        {orgSummary && <DevTrendChips trend={orgSummary.development_trend} testId="dev-trend-strip" />}
      </div>

      {orgSummary && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Athletes" value={orgSummary.athletes} icon={Users} tint="bg-brand/15 text-brand" testId="stat-org-athletes" to="/players" />
            <StatCard label="Coaches" value={orgSummary.coaches} sub={`${orgSummary.evaluators ?? 0} evaluators`} icon={UsersRound} testId="stat-org-coaches" to="/staff" />
            <StatCard label="Awaiting Review" value={orgSummary.evaluations?.awaiting_review} icon={ClipboardList} tint="bg-warning/15 text-warning" testId="stat-org-awaiting-review" to="/review" />
            <StatCard label="Upcoming Events" value={orgSummary.events?.upcoming} sub={`${orgSummary.events?.total ?? 0} total`} icon={CalendarDays} tint="bg-info/15 text-info" testId="stat-org-upcoming-events" to={ev ? `/events/${ev.id}` : "/events"} />
          </div>
          {gradClasses.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-2" data-testid="grad-class-strip">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <GraduationCap className="h-3.5 w-3.5" /> Grad Classes
              </span>
              <Select onValueChange={(year) => navigate(`/players?graduation_year=${year}`)}>
                <SelectTrigger className="h-9 w-[230px] rounded-xl bg-card text-sm font-semibold" data-testid="grad-class-select">
                  <SelectValue placeholder="Class of…" />
                </SelectTrigger>
                <SelectContent>
                  {gradClasses.map((g) => (
                    <SelectItem key={g.year} value={String(g.year)} data-testid={`grad-class-${g.year}`}>
                      <span className="font-mono-num">Class of {g.year} · {g.count} athlete{g.count === 1 ? "" : "s"}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* MAIN COLUMN */}
        <div className="space-y-4 lg:col-span-2">
          {ev ? (
            <Card className="rounded-2xl border-border bg-card overflow-hidden">
              <div className="hero-sweep px-5 py-4 border-b flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <PanelLabel>Upcoming / Active Event</PanelLabel>
                  <Link to={`/events/${ev.id}`} className="block font-display text-2xl leading-tight text-foreground break-words hover:underline" data-testid="dashboard-event-link">{ev.name}</Link>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><CalendarDays className="h-3.5 w-3.5" /> {ev.date} · {ev.location}</p>
                </div>
                <StatusBadge status={ev.status} testId="event-status-badge" />
              </div>
              <CardContent className="pt-4 pb-5">
                <div className="grid grid-cols-2 2xl:grid-cols-4 gap-3">
                  <StatCard label="Registered Players" value={stats.registered} icon={Users} testId="stat-registered" to={`/events/${ev.id}?tab=checkin`} />
                  <StatCard label="Checked In" value={stats.checked_in} icon={CheckCircle2} tint="bg-success/15 text-success" testId="stat-checked-in" to={`/events/${ev.id}?tab=checkin`} />
                  <StatCard label="Evaluations Completed" value={stats.evaluations_completed} icon={ClipboardCheck} tint="bg-info/15 text-info" testId="stat-evals-completed" to={`/events/${ev.id}?tab=progress`} />
                  <StatCard label="Drafts In Progress" value={stats.evaluations_draft} icon={Activity} tint="bg-warning/15 text-warning" testId="stat-evals-draft" to={`/events/${ev.id}?tab=progress`} />
                </div>
              </CardContent>
            </Card>
          ) : (
            <EmptyState icon={CalendarDays} title="No events yet" hint="Create your first evaluation event to get started."
              action={isAdmin && <Button onClick={() => navigate("/events")} className="rounded-xl bg-primary">Create Event</Button>} />
          )}

          {evalInsights && (
            <Card className="rounded-2xl border-border bg-card" data-testid="hq-performance-snapshot">
              <CardContent className="pt-4 pb-4">
                <PanelLabel>Performance snapshot</PanelLabel>
                <div className="mt-3">
                  <StatusDonut totals={evalInsights.totals} />
                </div>
              </CardContent>
            </Card>
          )}

          {evalInsights && (evalInsights.recent || []).length > 0 && (
            <div data-testid="hq-recent-rail">
              <div className="flex items-center justify-between gap-2">
                <PanelLabel>Recent evaluations</PanelLabel>
                <Link to="/review" className="text-xs font-semibold text-primary hover:underline">View all →</Link>
              </div>
              <div className="mt-2 flex gap-3 overflow-x-auto pb-2 snap-x">
                {evalInsights.recent.map((r) => <HqRecentEvalCard key={r.id} r={r} />)}
              </div>
            </div>
          )}

          {isAdmin && (
            <Card className="rounded-2xl border-border bg-card">
              <CardContent className="pt-4 pb-4">
                <PanelLabel>Quick actions</PanelLabel>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <QuickAction to="/events" icon={CalendarPlus} label="Create Event" testId="quick-action-create-event" />
                  <QuickAction to="/players/import" icon={Upload} label="Import Athletes" testId="quick-action-import-players" />
                  {ev && <QuickAction to={`/events/${ev.id}?tab=evaluators`} icon={UserCog} label="Assign Evaluators" testId="quick-action-assign-evaluators" />}
                  {ev && <QuickAction to={`/events/${ev.id}?tab=checkin`} icon={ClipboardCheck} label="Open Check-In" testId="quick-action-open-checkin" />}
                  {ev && <QuickAction to={`/events/${ev.id}?tab=progress`} icon={Activity} label="View Live Progress" testId="quick-action-live-progress" />}
                  {ev && <QuickAction onClick={() => window.open(signedUrl(`/reports/event-results/${ev.id}/csv`), "_blank")} icon={FileDown} label="Export Results" testId="quick-action-export-results" />}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* RIGHT RAIL */}
        <div className="space-y-4 lg:col-span-1">
          {evalInsights && (
            <Card className="rounded-2xl border-border bg-card">
              <CardContent className="pt-4 pb-4">
                <HqTopPerformers performers={evalInsights.top_performers} />
              </CardContent>
            </Card>
          )}

          <Card className="rounded-2xl border-border bg-card">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between gap-2">
                <PanelLabel>Recently added players</PanelLabel>
                <Link to="/players" className="text-xs font-semibold text-primary hover:underline">View all ({data?.total_players})</Link>
              </div>
              <div className="mt-2 space-y-1.5">
                {(data?.recent_players || []).map((p) => (
                  <Link key={p.id} to={`/players/${p.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-secondary transition-colors">
                    <PlayerAvatar firstName={p.first_name} lastName={p.last_name} photoUrl={p.photo_url} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{p.first_name} {p.last_name}</p>
                      <p className="text-xs text-muted-foreground">{p.age_group} · {p.primary_position}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
