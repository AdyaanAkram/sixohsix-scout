import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, errMsg, signedUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Trophy, FileDown, AlertTriangle, ClipboardList, GitCompare, Layers, Users, TrendingUp, FileText, Target,
  Flag, ArrowUpRight, ArrowDownRight, Minus, ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  LineChart, Line, Legend, ReferenceLine,
} from "recharts";

const AGE_GROUPS = ["7U", "8U", "9U", "10U", "11U", "12U", "13U", "14U", "15U", "16U", "17U", "18U", "College", "Pro"];
const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
const CATEGORIES = ["Hitting", "Defense", "Athleticism", "Arm Strength", "Baseball IQ", "Coachability"];

// Roles the player report / progress report endpoints accept
// (REVIEW_ROLES + "coach" in backend/routes_reports.py). Evaluators land on this
// page too, so the export links are hidden rather than served a 403.
const REPORT_ROLES = ["owner", "admin", "head_scout", "coach"];

// Evaluator-disagreement severity bands.
//
// The numeric cutoffs are owned by the backend
// (DISAGREEMENT_REVIEW_THRESHOLD / DISAGREEMENT_CRITICAL_THRESHOLD in
// backend/routes_reports.py) and travel on every row as `review_threshold` /
// `critical_threshold`, so this file deliberately holds NO cutoff of its own —
// only the label and colour for each band the backend reports. Change the
// bounds in one place, server-side, and this view follows.
const SEVERITY = {
  critical: { label: "Critical", fill: "hsl(var(--destructive))", text: "text-destructive", chip: "bg-destructive/15 text-destructive" },
  review: { label: "Review", fill: "hsl(var(--warning))", text: "text-warning", chip: "bg-warning/20 text-warning" },
  normal: { label: "Within variance", fill: "hsl(var(--muted-foreground))", text: "text-muted-foreground", chip: "bg-secondary text-muted-foreground" },
};
const severityOf = (row) => SEVERITY[row?.severity] || SEVERITY.normal;

const num = (v) => (v === null || v === undefined ? "—" : v);
const fmtDelta = (v) => (v === null || v === undefined ? "—" : v > 0 ? `+${v}` : `${v}`);
const deltaClass = (v) => (v === null || v === undefined ? "text-muted-foreground" : v > 0 ? "text-success" : v < 0 ? "text-destructive" : "text-muted-foreground");

const chartTooltip = {
  contentStyle: { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12 },
};

const NotEnoughData = () => <p className="text-xs text-muted-foreground">Not enough data yet.</p>;

const PanelLabel = ({ children }) => (
  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>
);

const scrollToTabs = () => {
  document.getElementById("reports-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
};

// The report hub — one card per existing report tab. Focusing a card switches
// the tab below; no data is fetched until the tab's own effect runs, as before.
const REPORT_DEFS = [
  { tab: "leaderboard", icon: Trophy, tint: "bg-warning/15 text-warning", name: "Leaderboard", desc: "Ranked players for the selected event and filters." },
  { tab: "categories", icon: Layers, tint: "bg-brand/15 text-brand", name: "Category ranking", desc: "Top players in each scored category, with averages." },
  { tab: "positions", icon: Users, tint: "bg-info/15 text-info", name: "Position comparison", desc: "Average and best overall score by primary position." },
  { tab: "progress", icon: TrendingUp, tint: "bg-success/15 text-success", name: "Player progress", desc: "Score trend, category change and goal progress per player." },
  { tab: "completion", icon: ClipboardList, tint: "bg-info/15 text-info", name: "Completion", desc: "Per-station evaluation completion for the event roster." },
  { tab: "disagreement", icon: AlertTriangle, tint: "bg-destructive/15 text-destructive", name: "Disagreement", desc: "Evaluator score spreads flagged for a second look." },
];

// One insight card on the landing strip. Renders as a link (route cards) or a
// button (cards that focus one of the existing tabs below).
const InsightCard = ({ icon: Icon, tint = "bg-brand/15 text-brand", title, to, onClick, testId, children }) => {
  const body = (
    <Card className="rounded-2xl border-border h-full hover:border-brand/50 transition-colors">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-2.5 mb-2">
          <div className={cn("h-8 w-8 rounded-lg grid place-items-center shrink-0", tint)}>
            <Icon className="h-4 w-4" />
          </div>
          <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">{title}</p>
        </div>
        {children}
      </CardContent>
    </Card>
  );
  return to ? (
    <Link to={to} data-testid={testId} className="block h-full">{body}</Link>
  ) : (
    <button type="button" onClick={onClick} data-testid={testId} className="block h-full w-full text-left cursor-pointer">{body}</button>
  );
};

export default function Reports() {
  const { user } = useAuth();
  const canExportPlayerReports = REPORT_ROLES.includes(user?.role);

  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState("");
  const [ageGroup, setAgeGroup] = useState("all");
  const [position, setPosition] = useState("all");
  const [category, setCategory] = useState("overall");
  const [leaderboard, setLeaderboard] = useState(null);
  const [completion, setCompletion] = useState(null);
  const [disagreement, setDisagreement] = useState(null);
  const [categoryRanking, setCategoryRanking] = useState(null);
  const [positionComparison, setPositionComparison] = useState(null);
  const [severityFilter, setSeverityFilter] = useState("all");
  const [tab, setTab] = useState("leaderboard");

  // progress report
  const [athletes, setAthletes] = useState([]);
  const [progressId, setProgressId] = useState("");
  const [progress, setProgress] = useState(null);

  // Landing insights — org-wide, independent of the event/tab filters below.
  // null = loading, false = endpoint unavailable (strip hides entirely).
  const [insights, setInsights] = useState(null);
  useEffect(() => {
    api.get("/reports/insights").then((r) => setInsights(r.data || false)).catch(() => setInsights(false));
  }, []);

  useEffect(() => {
    api.get("/events").then((r) => {
      setEvents(r.data);
      if (r.data.length > 0) setEventId(r.data[0].id);
    });
  }, []);

  useEffect(() => {
    if (!eventId) return;
    const params = { event_id: eventId };
    if (ageGroup !== "all") params.age_group = ageGroup;
    if (position !== "all") params.position = position;
    if (category !== "overall") params.category = category;
    setLeaderboard(null);
    api.get("/reports/leaderboard", { params }).then((r) => setLeaderboard(r.data)).catch((e) => { toast.error(errMsg(e)); setLeaderboard([]); });
  }, [eventId, ageGroup, position, category]);

  useEffect(() => {
    if (!eventId) return;
    if (tab === "completion" && !completion) {
      api.get(`/reports/event-completion/${eventId}`).then((r) => setCompletion(r.data)).catch(() => setCompletion({ rows: [] }));
    }
    if (tab === "disagreement" && !disagreement) {
      api.get(`/reports/disagreement/${eventId}`).then((r) => setDisagreement(r.data)).catch(() => setDisagreement([]));
    }
    if (tab === "categories" && !categoryRanking) {
      const params = { event_id: eventId, limit: 10 };
      if (ageGroup !== "all") params.age_group = ageGroup;
      if (position !== "all") params.position = position;
      if (category !== "overall") params.category = category;
      api.get("/reports/category-ranking", { params }).then((r) => setCategoryRanking(r.data)).catch(() => setCategoryRanking({ categories: [] }));
    }
    if (tab === "positions" && !positionComparison) {
      const params = { event_id: eventId };
      if (ageGroup !== "all") params.age_group = ageGroup;
      api.get("/reports/position-comparison", { params }).then((r) => setPositionComparison(r.data)).catch(() => setPositionComparison({ positions: [] }));
    }
  }, [tab, eventId, ageGroup, position, category, completion, disagreement, categoryRanking, positionComparison]);

  // Any filter/event change invalidates the cached per-tab reports.
  useEffect(() => { setCompletion(null); setDisagreement(null); }, [eventId]);
  useEffect(() => { setCategoryRanking(null); setPositionComparison(null); }, [eventId, ageGroup, position, category]);

  useEffect(() => {
    if (tab !== "progress" || athletes.length > 0) return;
    api.get("/athletes", { params: { limit: 200 } })
      .then((r) => setAthletes(r.data?.athletes || r.data || []))
      .catch((e) => toast.error(errMsg(e)));
  }, [tab, athletes.length]);

  useEffect(() => {
    if (!progressId) { setProgress(null); return; }
    setProgress(null);
    api.get(`/reports/player/${progressId}/progress`)
      .then((r) => setProgress(r.data))
      .catch((e) => { toast.error(errMsg(e)); setProgress(false); });
  }, [progressId]);

  const leaderboardChart = useMemo(() => {
    if (!leaderboard?.length) return [];
    return leaderboard.slice(0, 10).map((r) => ({
      name: `${r.athlete?.first_name?.[0] || ""}. ${r.athlete?.last_name || ""}`,
      score: Number(r.score) || 0,
      rank: r.rank,
    }));
  }, [leaderboard]);

  const completionChart = useMemo(() => {
    if (!completion?.rows?.length || !completion?.station_names?.length) return [];
    return completion.station_names.map((name) => {
      let complete = 0;
      let draft = 0;
      let missing = 0;
      completion.rows.forEach((r) => {
        const st = r.stations?.[name];
        if (st === "complete") complete += 1;
        else if (st === "draft") draft += 1;
        else if (st === "missing") missing += 1;
      });
      const applicable = complete + draft + missing;
      return {
        name: name.length > 14 ? `${name.slice(0, 12)}…` : name,
        complete,
        draft,
        missing,
        pct: applicable ? Math.round((complete / applicable) * 100) : 0,
      };
    });
  }, [completion]);

  // Thresholds come from the payload, never from a constant in this file.
  const bands = useMemo(() => {
    const row = disagreement?.[0];
    if (!row) return null;
    return { review: row.review_threshold, critical: row.critical_threshold };
  }, [disagreement]);

  const disagreementRows = useMemo(() => {
    if (!disagreement?.length) return [];
    if (severityFilter === "all") return disagreement;
    if (severityFilter === "flagged") return disagreement.filter((d) => d.severity !== "normal");
    return disagreement.filter((d) => d.severity === severityFilter);
  }, [disagreement, severityFilter]);

  const disagreementChart = useMemo(() => (
    disagreementRows.slice(0, 12).map((d) => ({
      name: `${d.athlete?.last_name || "?"} · ${(d.station_name || "").slice(0, 10)}`,
      spread: d.spread,
      stdev: d.stdev,
      severity: d.severity,
    }))
  ), [disagreementRows]);

  // Only categories that actually have scored players — a category with no
  // data is reported as such, never charted as a zero.
  const categoryAverageChart = useMemo(() => (
    (categoryRanking?.categories || [])
      .filter((c) => c.average_score !== null && c.average_score !== undefined)
      .map((c) => ({ name: c.category, average: c.average_score, top: c.top_score, players: c.scored_players }))
  ), [categoryRanking]);

  const positionChart = useMemo(() => (
    (positionComparison?.positions || [])
      .filter((p) => p.average_overall !== null && p.average_overall !== undefined)
      .map((p) => ({ name: p.position, average: p.average_overall, best: p.best_overall, players: p.player_count }))
  ), [positionComparison]);

  const progressTrendChart = useMemo(() => (
    (progress?.timeline || []).map((p) => ({ name: p.label, score: p.overall_score }))
  ), [progress]);

  const progressDeltaChart = useMemo(() => (
    (progress?.category_deltas || [])
      .filter((d) => d.previous_score !== null && d.current_score !== null)
      .map((d) => ({ name: d.category, first: d.previous_score, latest: d.current_score }))
  ), [progress]);

  const openPdf = (path) => window.open(signedUrl(path), "_blank");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-4xl text-foreground">Reports</h1>
        <p className="text-sm text-muted-foreground">Internal rankings and completion reports. Not for public distribution.</p>
      </div>

      {/* ---------------- Report hub ---------------- */}
      <div className="space-y-1.5">
        <PanelLabel>Reports &amp; analytics</PanelLabel>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="reports-hub">
          {REPORT_DEFS.map(({ tab: t, icon: Icon, tint, name, desc }) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); scrollToTabs(); }}
              data-testid={`reports-hub-${t}`}
              className="block h-full w-full text-left cursor-pointer"
            >
              <Card className={cn("rounded-2xl border-border bg-card h-full transition-colors hover:bg-secondary/50", tab === t && "border-brand/50")}>
                <CardContent className="pt-4 pb-4 flex items-start gap-3">
                  <div className={cn("h-10 w-10 rounded-lg grid place-items-center shrink-0", tint)}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{name}</p>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                    <span className="mt-1.5 inline-block text-xs font-semibold text-primary">View report →</span>
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}
          <Card className="rounded-2xl border-border bg-card h-full">
            <CardContent className="pt-4 pb-4 flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg grid place-items-center shrink-0 bg-brand/15 text-brand">
                <GitCompare className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Compare players</p>
                <p className="text-xs text-muted-foreground">Side-by-side score comparison across athletes.</p>
                <Button asChild variant="outline" size="sm" className="mt-2 rounded-lg h-8" data-testid="reports-compare-link">
                  <Link to="/scout/compare"><GitCompare className="h-3.5 w-3.5 mr-1" /> Open compare</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
          {eventId && (
            <Card className="rounded-2xl border-border bg-card h-full">
              <CardContent className="pt-4 pb-4 flex items-start gap-3">
                <div className="h-10 w-10 rounded-lg grid place-items-center shrink-0 bg-success/15 text-success">
                  <FileDown className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">Event results CSV</p>
                  <p className="text-xs text-muted-foreground">Full results export for the selected event.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 rounded-lg h-8"
                    onClick={() => window.open(signedUrl(`/reports/event-results/${eventId}/csv`), "_blank")}
                    data-testid="reports-export-csv-button"
                  >
                    <FileDown className="h-3.5 w-3.5 mr-1" /> Export CSV
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ---------------- Insight cards landing strip ---------------- */}
      {insights === null ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
      ) : insights === false ? null : (
        <div className="space-y-1.5">
        <PanelLabel>At a glance</PanelLabel>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="reports-insights">
          <InsightCard
            icon={TrendingUp} tint="bg-success/15 text-success" title="Top Movers" testId="insight-top-movers"
            onClick={() => {
              setTab("progress");
              const first = insights.top_movers?.[0]?.athlete?.id;
              if (!progressId && first) setProgressId(first);
            }}
          >
            {insights.top_movers?.length ? (
              <div className="space-y-1.5">
                {insights.top_movers.slice(0, 3).map((m) => (
                  <div key={m.athlete?.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-semibold truncate">{m.athlete?.first_name} {m.athlete?.last_name}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="inline-flex items-center text-success font-mono-num font-bold text-xs">
                        <ArrowUpRight className="h-3.5 w-3.5" />{m.change > 0 ? "+" : ""}{m.change}
                      </span>
                      <span className="font-mono-num text-xs text-muted-foreground">{num(m.current_score)}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : <NotEnoughData />}
          </InsightCard>

          <InsightCard icon={ClipboardList} tint="bg-brand/15 text-brand" title="Evaluations Complete" testId="insight-evaluations" onClick={() => setTab("completion")}>
            {insights.evaluations?.completed === null || insights.evaluations?.completed === undefined ? <NotEnoughData /> : (
              <p className="font-mono-num text-3xl font-bold text-foreground">
                {insights.evaluations.completed}
                {insights.evaluations.expected !== null && insights.evaluations.expected !== undefined && (
                  <span className="text-base font-normal text-muted-foreground"> / {insights.evaluations.expected} expected</span>
                )}
              </p>
            )}
          </InsightCard>

          <InsightCard icon={ClipboardCheck} tint="bg-warning/15 text-warning" title="Needs Review" to="/review" testId="insight-needs-review">
            {insights.needs_review === null || insights.needs_review === undefined ? <NotEnoughData /> : (
              <p className="font-mono-num text-3xl font-bold text-foreground">
                {insights.needs_review}
                <span className="text-base font-normal text-muted-foreground"> awaiting review</span>
              </p>
            )}
          </InsightCard>

          <InsightCard icon={Flag} tint="bg-destructive/15 text-destructive" title="Flagged" to="/players" testId="insight-flagged">
            {insights.flagged === null || insights.flagged === undefined ? <NotEnoughData /> : (
              <p className="font-mono-num text-3xl font-bold text-foreground">
                {insights.flagged}
                <span className="text-base font-normal text-muted-foreground"> flagged for follow-up</span>
              </p>
            )}
          </InsightCard>

          <InsightCard icon={Users} tint="bg-info/15 text-info" title="Position Snapshot" testId="insight-positions" onClick={() => setTab("positions")}>
            {insights.position_snapshot?.length ? (
              <div className="space-y-1.5">
                {[...insights.position_snapshot].sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 3).map((p) => (
                  <div key={p.position} className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-semibold">{p.position}</span>
                    <span className="font-mono-num text-xs text-muted-foreground">
                      {p.count} player{p.count === 1 ? "" : "s"}
                      {p.avg_score !== null && p.avg_score !== undefined ? <> · avg <span className="font-bold text-foreground">{p.avg_score}</span></> : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : <NotEnoughData />}
          </InsightCard>

          <InsightCard icon={TrendingUp} tint="bg-success/15 text-success" title="Development Trend" testId="insight-trend" onClick={() => setTab("progress")}>
            {insights.development_trend ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                <span className="inline-flex items-center gap-1 text-success font-semibold">
                  <ArrowUpRight className="h-4 w-4" /><span className="font-mono-num font-bold">{num(insights.development_trend.improving)}</span> improving
                </span>
                <span className="inline-flex items-center gap-1 text-destructive font-semibold">
                  <ArrowDownRight className="h-4 w-4" /><span className="font-mono-num font-bold">{num(insights.development_trend.declining)}</span> declining
                </span>
                <span className="inline-flex items-center gap-1 text-muted-foreground font-semibold">
                  <Minus className="h-4 w-4" /><span className="font-mono-num font-bold">{num(insights.development_trend.flat)}</span> flat
                </span>
              </div>
            ) : <NotEnoughData />}
          </InsightCard>
        </div>
        </div>
      )}

      <div className="space-y-1.5">
        <PanelLabel>Event &amp; filters</PanelLabel>
        <div className="flex flex-wrap gap-2">
        <Select value={eventId} onValueChange={setEventId}>
          <SelectTrigger className="w-[240px] h-11 rounded-xl bg-card" data-testid="reports-event-select"><SelectValue placeholder="Select event" /></SelectTrigger>
          <SelectContent>{events.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={ageGroup} onValueChange={setAgeGroup}>
          <SelectTrigger className="w-[110px] h-11 rounded-xl bg-card" data-testid="reports-age-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All ages</SelectItem>{AGE_GROUPS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={position} onValueChange={setPosition}>
          <SelectTrigger className="w-[130px] h-11 rounded-xl bg-card" data-testid="reports-position-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All positions</SelectItem>{POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[150px] h-11 rounded-xl bg-card" data-testid="reports-category-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="overall">Overall score</SelectItem>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
        </div>
      </div>

      <div id="reports-tabs" className="scroll-mt-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-xl bg-secondary h-11 flex-wrap">
          <TabsTrigger value="leaderboard" className="rounded-lg px-4 data-[state=active]:bg-primary data-[state=active]:text-white" data-testid="reports-tab-leaderboard">Leaderboard</TabsTrigger>
          <TabsTrigger value="categories" className="rounded-lg px-4 data-[state=active]:bg-primary data-[state=active]:text-white" data-testid="reports-tab-categories">Category ranking</TabsTrigger>
          <TabsTrigger value="positions" className="rounded-lg px-4 data-[state=active]:bg-primary data-[state=active]:text-white" data-testid="reports-tab-positions">Position comparison</TabsTrigger>
          <TabsTrigger value="progress" className="rounded-lg px-4 data-[state=active]:bg-primary data-[state=active]:text-white" data-testid="reports-tab-progress">Player progress</TabsTrigger>
          <TabsTrigger value="completion" className="rounded-lg px-4 data-[state=active]:bg-primary data-[state=active]:text-white" data-testid="reports-tab-completion">Completion</TabsTrigger>
          <TabsTrigger value="disagreement" className="rounded-lg px-4 data-[state=active]:bg-primary data-[state=active]:text-white" data-testid="reports-tab-disagreement">Disagreement</TabsTrigger>
        </TabsList>

        {/* ---------------- Leaderboard ---------------- */}
        <TabsContent value="leaderboard" className="mt-4 space-y-4">
          {!leaderboard ? <Skeleton className="h-64 rounded-2xl" /> : leaderboard.length === 0 ? (
            <EmptyState icon={Trophy} title="No ranked players" hint="Rankings appear when evaluations are submitted for this event and filters." />
          ) : (
            <>
              {leaderboardChart.length > 0 && (
                <Card className="rounded-2xl border-border" data-testid="leaderboard-chart">
                  <CardContent className="pt-5 pb-4">
                    <p className="text-sm font-semibold mb-3">Top scores</p>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={leaderboardChart} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                          <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
                          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} domain={[0, 10]} />
                          <Tooltip
                            {...chartTooltip}
                            formatter={(v) => [v, category === "overall" ? "Overall" : category]}
                          />
                          <Bar dataKey="score" radius={[6, 6, 0, 0]}>
                            {leaderboardChart.map((entry) => (
                              <Cell key={entry.rank} fill={entry.rank <= 3 ? "hsl(var(--warning))" : "hsl(var(--brand))"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}
              <Card className="rounded-2xl border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <Table data-testid="leaderboard-table">
                    <TableHeader>
                      <TableRow className="bg-secondary">
                        <TableHead className="w-14">Rank</TableHead><TableHead>Player</TableHead>
                        <TableHead>Age</TableHead><TableHead>Pos</TableHead><TableHead>Team</TableHead>
                        <TableHead className="text-right">{category === "overall" ? "Overall" : category}</TableHead>
                        <TableHead className="text-right"># Evals</TableHead>
                        {canExportPlayerReports && <TableHead className="text-right">Reports</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {leaderboard.map((r) => (
                        <TableRow key={r.athlete.id}>
                          <TableCell>
                            <span className={cn("font-display text-xl", r.rank <= 3 ? "text-warning" : "text-muted-foreground")}>{r.rank}</span>
                          </TableCell>
                          <TableCell><Link to={`/players/${r.athlete.id}`} className="font-semibold text-foreground hover:underline">{r.athlete.first_name} {r.athlete.last_name}</Link></TableCell>
                          <TableCell>{r.athlete.age_group}</TableCell>
                          <TableCell>{r.athlete.primary_position}</TableCell>
                          <TableCell className="text-muted-foreground">{r.athlete.current_team || "—"}</TableCell>
                          <TableCell className="text-right font-mono-num font-bold">{r.score}</TableCell>
                          <TableCell className="text-right font-mono-num text-muted-foreground">{r.evaluation_count}</TableCell>
                          {canExportPlayerReports && (
                            <TableCell className="text-right whitespace-nowrap">
                              <Button variant="ghost" size="sm" className="h-8 px-2" title="Player evaluation PDF"
                                onClick={() => openPdf(`/reports/player/${r.athlete.id}/pdf`)}
                                data-testid={`leaderboard-player-pdf-${r.athlete.id}`}>
                                <FileText className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" className="h-8 px-2" title="Progress report PDF"
                                onClick={() => openPdf(`/reports/player/${r.athlete.id}/progress/pdf`)}
                                data-testid={`leaderboard-progress-pdf-${r.athlete.id}`}>
                                <TrendingUp className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ---------------- Category ranking ---------------- */}
        <TabsContent value="categories" className="mt-4 space-y-4">
          {!categoryRanking ? <Skeleton className="h-64 rounded-2xl" /> : (categoryRanking.categories || []).length === 0 ? (
            <EmptyState icon={Layers} title="No category scores" hint="Category rankings appear once evaluations with scored categories are submitted." />
          ) : (
            <>
              {categoryAverageChart.length > 0 && (
                <Card className="rounded-2xl border-border" data-testid="category-average-chart">
                  <CardContent className="pt-5 pb-4">
                    <p className="text-sm font-semibold">Average score by category</p>
                    <p className="text-xs text-muted-foreground mb-3">Averaged across the {categoryRanking.ranked_players} ranked player(s). Categories with no scores are omitted.</p>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={categoryAverageChart} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                          <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
                          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} domain={[0, 10]} />
                          <Tooltip {...chartTooltip} formatter={(v, n) => [v, n === "average" ? "Average" : "Top score"]} />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                          <Bar dataKey="average" name="Average" fill="hsl(var(--brand))" radius={[6, 6, 0, 0]} />
                          <Bar dataKey="top" name="Top score" fill="hsl(var(--muted-foreground))" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                {(categoryRanking.categories || []).map((c) => (
                  <Card key={c.category} className="rounded-2xl border-border overflow-hidden" data-testid={`category-card-${c.category}`}>
                    <CardContent className="pt-5 pb-4">
                      <div className="flex items-baseline justify-between">
                        <p className="text-sm font-semibold">{c.category}</p>
                        <span className="text-xs text-muted-foreground">weight {c.weight}%</span>
                      </div>
                      {c.scored_players === 0 ? (
                        <p className="mt-3 text-xs text-muted-foreground">No player has been scored in this category for the current filters.</p>
                      ) : (
                        <>
                          <p className="text-xs text-muted-foreground mb-2">
                            {c.scored_players} scored · average <span className="font-mono-num font-semibold">{num(c.average_score)}</span> · top <span className="font-mono-num font-semibold">{num(c.top_score)}</span>
                          </p>
                          <Table>
                            <TableBody>
                              {c.rows.map((r) => (
                                <TableRow key={r.athlete.id}>
                                  <TableCell className="w-8 font-display text-lg text-muted-foreground py-1.5">{r.rank}</TableCell>
                                  <TableCell className="py-1.5">
                                    <Link to={`/players/${r.athlete.id}`} className="font-semibold hover:underline">{r.athlete.first_name} {r.athlete.last_name}</Link>
                                    <span className="text-xs text-muted-foreground ml-2">{r.athlete.primary_position || "—"} · {r.athlete.age_group || "—"}</span>
                                  </TableCell>
                                  <TableCell className="text-right font-mono-num font-bold py-1.5">{r.score}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </TabsContent>

        {/* ---------------- Position comparison ---------------- */}
        <TabsContent value="positions" className="mt-4 space-y-4">
          {!positionComparison ? <Skeleton className="h-64 rounded-2xl" /> : (positionComparison.positions || []).length === 0 ? (
            <EmptyState icon={Users} title="No position data" hint="Position comparison needs ranked players with a primary position on file." />
          ) : (
            <>
              {positionChart.length > 0 && (
                <Card className="rounded-2xl border-border" data-testid="position-chart">
                  <CardContent className="pt-5 pb-4">
                    <p className="text-sm font-semibold">Average overall score by position</p>
                    <p className="text-xs text-muted-foreground mb-3">
                      {positionComparison.ranked_players} ranked player(s)
                      {positionComparison.org_average_overall !== null && positionComparison.org_average_overall !== undefined
                        ? <> · organisation average <span className="font-mono-num font-semibold">{positionComparison.org_average_overall}</span></> : null}
                      {positionComparison.players_without_position > 0
                        ? <> · {positionComparison.players_without_position} excluded (no position on file)</> : null}
                    </p>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={positionChart} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                          <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
                          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} domain={[0, 10]} />
                          <Tooltip {...chartTooltip} formatter={(v, n) => [v, n === "average" ? "Average overall" : "Best overall"]} />
                          <Legend wrapperStyle={{ fontSize: 12 }} />
                          {positionComparison.org_average_overall !== null && positionComparison.org_average_overall !== undefined && (
                            <ReferenceLine y={positionComparison.org_average_overall} stroke="hsl(var(--foreground))" strokeDasharray="4 4"
                              label={{ value: `org avg ${positionComparison.org_average_overall}`, fontSize: 10, fill: "hsl(var(--muted-foreground))", position: "insideTopRight" }} />
                          )}
                          <Bar dataKey="average" name="Average overall" fill="hsl(var(--brand))" radius={[6, 6, 0, 0]} />
                          <Bar dataKey="best" name="Best overall" fill="hsl(var(--muted-foreground))" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}
              <Card className="rounded-2xl border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <Table data-testid="position-table">
                    <TableHeader>
                      <TableRow className="bg-secondary">
                        <TableHead>Position</TableHead><TableHead className="text-right">Players</TableHead>
                        <TableHead className="text-right">Avg overall</TableHead><TableHead className="text-right">Median</TableHead>
                        <TableHead>Top player</TableHead>
                        {(positionComparison.categories || []).map((c) => <TableHead key={c} className="text-right text-xs whitespace-nowrap">{c}</TableHead>)}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {positionComparison.positions.map((p) => (
                        <TableRow key={p.position}>
                          <TableCell className="font-semibold">{p.position}</TableCell>
                          <TableCell className="text-right font-mono-num">{p.player_count}</TableCell>
                          <TableCell className="text-right font-mono-num font-bold">{num(p.average_overall)}</TableCell>
                          <TableCell className="text-right font-mono-num text-muted-foreground">{num(p.median_overall)}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {p.top_player ? (
                              <Link to={`/players/${p.top_player.athlete.id}`} className="hover:underline">
                                {p.top_player.athlete.first_name} {p.top_player.athlete.last_name}
                                <span className="font-mono-num text-muted-foreground ml-1.5">{p.top_player.overall_score}</span>
                              </Link>
                            ) : "—"}
                          </TableCell>
                          {(positionComparison.categories || []).map((c) => {
                            const avg = p.category_averages?.[c];
                            return (
                              <TableCell key={c} className="text-right font-mono-num text-xs" title={avg ? `${avg.scored_players} scored` : "no scores recorded"}>
                                {avg ? avg.average : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="px-4 py-2.5 border-t text-xs text-muted-foreground">
                  A dash means no player at that position has a recorded score in that category — it is not a zero.
                </div>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ---------------- Player progress ---------------- */}
        <TabsContent value="progress" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={progressId} onValueChange={setProgressId}>
              <SelectTrigger className="w-[280px] h-11 rounded-xl bg-card" data-testid="progress-player-select"><SelectValue placeholder="Select a player" /></SelectTrigger>
              <SelectContent>
                {athletes.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.first_name} {a.last_name} · {a.primary_position || "—"} · {a.age_group || "—"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {progressId && canExportPlayerReports && (
              <Button variant="outline" className="rounded-xl h-11" onClick={() => openPdf(`/reports/player/${progressId}/progress/pdf`)} data-testid="progress-export-pdf">
                <FileDown className="h-4 w-4 mr-1" /> Progress PDF
              </Button>
            )}
            {progressId && canExportPlayerReports && (
              <Button variant="outline" className="rounded-xl h-11" onClick={() => openPdf(`/reports/player/${progressId}/pdf`)} data-testid="progress-export-player-pdf">
                <FileText className="h-4 w-4 mr-1" /> Evaluation PDF
              </Button>
            )}
          </div>

          {!progressId ? (
            <EmptyState icon={TrendingUp} title="Select a player" hint="The progress report shows score trend, category change, verified measurement change and goal progress over time." />
          ) : progress === null ? <Skeleton className="h-64 rounded-2xl" />
            : progress === false ? <EmptyState icon={TrendingUp} title="Progress unavailable" hint="This report could not be loaded for the selected player." />
            : (
              <>
                <Card className="rounded-2xl border-border">
                  <CardContent className="pt-5 pb-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link to={`/players/${progress.athlete.id}`} className="font-display text-2xl hover:underline">
                        {progress.athlete.first_name} {progress.athlete.last_name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {progress.athlete.primary_position || "—"} · {progress.athlete.age_group || "—"} · {progress.athlete.current_team || "no team on file"}
                      </p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-6">
                      <div>
                        <p className="text-xs text-muted-foreground">Current overall</p>
                        <p className="font-mono-num text-2xl font-bold text-brand">{num(progress.current_overall_score)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Evaluations</p>
                        <p className="font-mono-num text-2xl font-bold">{progress.evaluation_count}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Scored dates</p>
                        <p className="font-mono-num text-2xl font-bold">{progress.timeline.length}</p>
                      </div>
                      {progress.score_trend && (
                        <div>
                          <p className="text-xs text-muted-foreground">Change since first</p>
                          <p className={cn("font-mono-num text-2xl font-bold", deltaClass(progress.score_trend.delta))}>{fmtDelta(progress.score_trend.delta)}</p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card className="rounded-2xl border-border" data-testid="progress-trend-chart">
                  <CardContent className="pt-5 pb-4">
                    <p className="text-sm font-semibold mb-1">Score trend</p>
                    {progressTrendChart.length >= 2 ? (
                      <>
                        <p className="text-xs text-muted-foreground mb-3">
                          {progress.score_trend.first_score} on {progress.score_trend.first_date} → {progress.score_trend.latest_score} on {progress.score_trend.latest_date}
                        </p>
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={progressTrendChart} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                              <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
                              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} domain={[0, 10]} />
                              <Tooltip {...chartTooltip} formatter={(v) => [v, "Overall"]} />
                              <Line type="monotone" dataKey="score" stroke="hsl(var(--brand))" strokeWidth={2} dot={{ r: 4 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        A trend needs at least two scored evaluation dates; {progress.timeline.length === 1 ? "only one is" : "none are"} on record.
                      </p>
                    )}
                  </CardContent>
                </Card>

                <Card className="rounded-2xl border-border" data-testid="progress-category-deltas">
                  <CardContent className="pt-5 pb-4">
                    <p className="text-sm font-semibold mb-1">Category change — first vs latest evaluation</p>
                    {progress.category_deltas.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Needs at least two scored evaluation dates.</p>
                    ) : (
                      <>
                        {progressDeltaChart.length > 0 && (
                          <div className="h-64 mt-3">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={progressDeltaChart} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                                <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
                                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} domain={[0, 10]} />
                                <Tooltip {...chartTooltip} />
                                <Legend wrapperStyle={{ fontSize: 12 }} />
                                <Bar dataKey="first" name={`First (${progress.score_trend?.first_date || ""})`} fill="hsl(var(--muted-foreground))" radius={[6, 6, 0, 0]} />
                                <Bar dataKey="latest" name={`Latest (${progress.score_trend?.latest_date || ""})`} fill="hsl(var(--brand))" radius={[6, 6, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                        <Table className="mt-2">
                          <TableHeader>
                            <TableRow className="bg-secondary">
                              <TableHead>Category</TableHead><TableHead className="text-right">First</TableHead>
                              <TableHead className="text-right">Latest</TableHead><TableHead className="text-right">Change</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {progress.category_deltas.map((d) => (
                              <TableRow key={d.category}>
                                <TableCell className="font-semibold">{d.category}</TableCell>
                                <TableCell className="text-right font-mono-num">{num(d.previous_score)}</TableCell>
                                <TableCell className="text-right font-mono-num">{num(d.current_score)}</TableCell>
                                <TableCell className={cn("text-right font-mono-num font-bold", deltaClass(d.delta))}>{fmtDelta(d.delta)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card className="rounded-2xl border-border" data-testid="progress-measurements">
                  <CardContent className="pt-5 pb-4">
                    <p className="text-sm font-semibold mb-2">Verified measurement change</p>
                    {progress.measurements.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No verified measurements on record.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-secondary">
                            <TableHead>Measurement</TableHead><TableHead className="text-right">First</TableHead>
                            <TableHead className="text-right">Latest</TableHead><TableHead className="text-right">Change</TableHead>
                            <TableHead className="text-right">Readings</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {progress.measurements.map((m) => (
                            <TableRow key={m.metric_key}>
                              <TableCell className="font-semibold">{m.label}{m.unit ? <span className="text-xs text-muted-foreground ml-1">({m.unit})</span> : null}</TableCell>
                              <TableCell className="text-right font-mono-num">{m.first.value}<span className="block text-[10px] text-muted-foreground">{m.first.measured_at}</span></TableCell>
                              <TableCell className="text-right font-mono-num">{m.latest.value}<span className="block text-[10px] text-muted-foreground">{m.latest.measured_at}</span></TableCell>
                              <TableCell className="text-right font-mono-num font-bold">
                                {m.delta === null ? <span className="text-xs font-normal text-muted-foreground">single reading</span> : (
                                  <span className={m.improved === null ? "text-muted-foreground" : m.improved ? "text-success" : "text-destructive"}>{fmtDelta(m.delta)}</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-mono-num text-muted-foreground">{m.reading_count}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>

                <Card className="rounded-2xl border-border" data-testid="progress-goals">
                  <CardContent className="pt-5 pb-4">
                    <div className="flex items-baseline justify-between">
                      <p className="text-sm font-semibold">Goal progress</p>
                      {progress.goals.average_progress !== null && (
                        <span className="text-xs text-muted-foreground">{progress.goals.total} active · average <span className="font-mono-num font-semibold">{progress.goals.average_progress}%</span></span>
                      )}
                    </div>
                    {progress.goals.items.length === 0 ? (
                      <p className="mt-2 text-xs text-muted-foreground">No active development goals.</p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {progress.goals.items.map((g) => (
                          <div key={g.id}>
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-semibold flex items-center gap-1.5"><Target className="h-3.5 w-3.5 text-brand" /> {g.title}</span>
                              <span className="text-xs text-muted-foreground">{g.status} · {g.progress || 0}%{g.target_date ? ` · due ${g.target_date}` : ""}</span>
                            </div>
                            <Progress value={g.progress || 0} className="h-2 mt-1.5" />
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <p className="text-xs text-muted-foreground px-1">{progress.disclaimer}</p>
              </>
            )}
        </TabsContent>

        {/* ---------------- Completion ---------------- */}
        <TabsContent value="completion" className="mt-4 space-y-4">
          {!completion ? <Skeleton className="h-64 rounded-2xl" /> : (completion.rows || []).length === 0 ? (
            <EmptyState icon={ClipboardList} title="No completion data" hint="Add players to the event roster to see per-station completion." />
          ) : (
            <>
              {completionChart.length > 0 && (
                <Card className="rounded-2xl border-border" data-testid="completion-chart">
                  <CardContent className="pt-5 pb-4">
                    <p className="text-sm font-semibold mb-3">Station completion %</p>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={completionChart} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                          <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
                          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} domain={[0, 100]} unit="%" />
                          <Tooltip {...chartTooltip} formatter={(v) => [`${v}%`, "Complete"]} />
                          <Bar dataKey="pct" name="Complete %" fill="hsl(var(--brand))" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}
              <Card className="rounded-2xl border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <Table data-testid="completion-table">
                    <TableHeader>
                      <TableRow className="bg-secondary">
                        <TableHead>Player</TableHead><TableHead>Bib</TableHead><TableHead>Check-In</TableHead>
                        {(completion.station_names || []).map((s) => <TableHead key={s} className="text-center text-xs">{s}</TableHead>)}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {completion.rows.map((r) => (
                        <TableRow key={r.athlete.id}>
                          <TableCell className="font-semibold whitespace-nowrap">{r.athlete.first_name} {r.athlete.last_name}</TableCell>
                          <TableCell className="font-mono-num">{r.bib_number || "—"}</TableCell>
                          <TableCell><span className={cn("text-xs font-semibold", r.check_in_status === "checked_in" ? "text-success" : "text-muted-foreground")}>{r.check_in_status === "checked_in" ? "In" : r.check_in_status}</span></TableCell>
                          {(completion.station_names || []).map((s) => {
                            const st = r.stations[s];
                            return (
                              <TableCell key={s} className="text-center">
                                <span className={cn("inline-block h-2.5 w-2.5 rounded-full",
                                  st === "complete" ? "bg-success" : st === "draft" ? "bg-warning" : st === "missing" ? "bg-destructive" : "bg-slate-200")} title={st} />
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="px-4 py-3 border-t flex gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-success inline-block" /> Complete</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-warning inline-block" /> Draft</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-destructive inline-block" /> Missing</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-200 inline-block" /> N/A</span>
                </div>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ---------------- Evaluator disagreement ---------------- */}
        <TabsContent value="disagreement" className="mt-4 space-y-4">
          {!disagreement ? <Skeleton className="h-64 rounded-2xl" /> : disagreement.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="No disagreements found" hint="When two evaluators score the same player at the same station, differences appear here." />
          ) : (
            <>
              {bands && (
                <Card className="rounded-2xl border-border" data-testid="disagreement-chart">
                  <CardContent className="pt-5 pb-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">Score spread between evaluators</p>
                        <p className="text-xs text-muted-foreground">
                          Spread is max − min on the 0–10 overall score. Flagged at <span className="font-mono-num font-semibold">{bands.review}</span> (review) and{" "}
                          <span className="font-mono-num font-semibold">{bands.critical}</span> (critical) — thresholds set server-side and returned with the data.
                        </p>
                      </div>
                      <Select value={severityFilter} onValueChange={setSeverityFilter}>
                        <SelectTrigger className="w-[190px] h-10 rounded-xl bg-card" data-testid="disagreement-severity-filter"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All {disagreement.length}</SelectItem>
                          <SelectItem value="flagged">Needs review ({disagreement.filter((d) => d.severity !== "normal").length})</SelectItem>
                          <SelectItem value="critical">Critical only ({disagreement.filter((d) => d.severity === "critical").length})</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {disagreementChart.length === 0 ? (
                      <p className="mt-4 text-xs text-muted-foreground">No disagreement matches this severity filter.</p>
                    ) : (
                      <div className="h-72 mt-3">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={disagreementChart} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                            <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} domain={[0, 10]} />
                            <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} width={140} />
                            <Tooltip
                              {...chartTooltip}
                              formatter={(v, n) => [v, n === "spread" ? "Spread (max−min)" : "Std dev"]}
                            />
                            <ReferenceLine x={bands.review} stroke="hsl(var(--warning))" strokeDasharray="4 4"
                              label={{ value: `review ${bands.review}`, fontSize: 10, fill: "hsl(var(--warning))", position: "top" }} />
                            <ReferenceLine x={bands.critical} stroke="hsl(var(--destructive))" strokeDasharray="4 4"
                              label={{ value: `critical ${bands.critical}`, fontSize: 10, fill: "hsl(var(--destructive))", position: "top" }} />
                            <Bar dataKey="spread" name="spread" radius={[0, 6, 6, 0]}>
                              {disagreementChart.map((entry, i) => (
                                <Cell key={i} fill={(SEVERITY[entry.severity] || SEVERITY.normal).fill} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
                      {Object.entries(SEVERITY).map(([key, s]) => (
                        <span key={key} className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ background: s.fill }} /> {s.label}
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="space-y-2">
                {disagreementRows.map((d, i) => {
                  const sev = severityOf(d);
                  return (
                    <Card key={i} className={cn("rounded-2xl border-border", d.severity === "critical" && "border-destructive/50")} data-testid={`disagreement-row-${i}`}>
                      <CardContent className="py-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <Link to={`/players/${d.athlete?.id}`} className="font-semibold text-foreground hover:underline">{d.athlete?.first_name} {d.athlete?.last_name}</Link>
                            <p className="text-xs text-muted-foreground">{d.station_name}</p>
                          </div>
                          <div className="flex items-center gap-3 text-right">
                            <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", sev.chip)}>{sev.label}</span>
                            <span className="text-xs text-muted-foreground">
                              σ <span className="font-mono-num font-semibold text-foreground" data-testid={`disagreement-stdev-${i}`}>{d.stdev}</span>
                            </span>
                            <span className={cn("font-mono-num font-bold", sev.text)}>Δ {d.spread}</span>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {d.scores.map((s, j) => (
                            <span key={j} className="rounded-full bg-secondary px-3 py-1 text-xs font-medium">{s.evaluator}: <span className="font-mono-num font-bold">{s.score}</span></span>
                          ))}
                          <span className="text-xs text-muted-foreground">mean <span className="font-mono-num font-semibold">{d.mean}</span> · {d.evaluator_count} evaluators</span>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
}
