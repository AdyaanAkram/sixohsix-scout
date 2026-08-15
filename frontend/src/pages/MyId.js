import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { formatPermanentId } from "@/lib/utils";
import { IdRadarChart } from "@/components/common/IdRadarChart";
import { AssessmentContent } from "@/components/common/AssessmentContent";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { VerificationBadge } from "@/components/common/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { toast } from "sonner";
import { Pencil, TrendingUp, TrendingDown, Minus, Share2, Trophy, Sparkles, Target, CalendarClock } from "lucide-react";

/** Same five checks the staff PlayerProfile uses — athlete and staff must not disagree. */
function computeProfileCompletion(athlete, summary, mediaList) {
  const checks = [
    { key: "photo", label: "Updated photo", ok: Boolean(athlete?.photo_url) },
    { key: "height", label: "Current height", ok: Boolean(athlete?.height) },
    { key: "weight", label: "Current weight", ok: Boolean(athlete?.weight) },
    { key: "eval", label: "Recent evaluation", ok: (summary?.evaluation_count || 0) > 0 },
    {
      key: "video",
      label: "Approved video",
      ok: (mediaList || []).some(
        (m) =>
          (m.media_type || m.file_type || m.content_type || "").includes("video") &&
          (m.consent_status === "approved" || m.status === "approved" || m.consent_verified)
      ),
    },
  ];
  const done = checks.filter((c) => c.ok).length;
  return { pct: Math.round((done / checks.length) * 100), missing: checks.filter((c) => !c.ok).map((c) => c.label), checks };
}

/* verified_metrics rows are written by the coach-only POST /metrics endpoint, so a row
   with verified_by but no explicit source is coach-submitted, not unverified. */
const metricSource = (m) => m?.source || (m?.verified_by ? "coach_submitted" : undefined);

/* Personal-best chip order: the numbers scouts (and athletes) care about first. */
const PB_KEY_ORDER = [
  "exit_velocity", "sixty_yard_dash", "throwing_velocity", "pitching_velocity",
  "bat_speed", "pop_time", "home_to_first", "vertical_jump", "broad_jump", "ten_yd",
];

/* Goal statuses that still need work, worst-first — drives the top-3 pick. */
const PRIORITY_STATUS_RANK = { "Needs Attention": 0, "Active": 1, "Improving": 2, "Not Started": 3 };

const goalStatusTone = (status) =>
  status === "Needs Attention" ? "text-warning border-warning/40"
    : status === "Improving" ? "text-success border-success/40"
    : "text-muted-foreground border-border";

export default function MyId() {
  const [athlete, setAthlete] = useState(null);
  const [summary, setSummary] = useState(null);
  const [evals, setEvals] = useState([]);
  const [card, setCard] = useState(null);
  const [metricsPack, setMetricsPack] = useState({ metrics: [], milestones: [] });
  const [awards, setAwards] = useState([]);
  const [pendingMedia, setPendingMedia] = useState([]);
  const [media, setMedia] = useState([]);
  const [goals, setGoals] = useState([]);
  const [assessments, setAssessments] = useState([]);

  const reload = () => {
    Promise.all([
      api.get("/me/athlete"),
      api.get("/me/evaluations"),
      api.get("/me/id-card"),
      api.get("/me/summary"),
      api.get("/me/metrics").catch(() => ({ data: { metrics: [], milestones: [] } })),
      api.get("/me/awards").catch(() => ({ data: [] })),
      api.get("/media/pending-consent").catch(() => ({ data: [] })),
      // No athlete-facing media list ships yet; completion falls back to "no approved video".
      api.get("/me/media").catch(() => ({ data: [] })),
      // Published AI assessments only — the section renders nothing when empty.
      api.get("/me/assessments").catch(() => ({ data: [] })),
    ]).then(([a, e, c, s, m, aw, pm, md, asmt]) => {
      setAthlete(a.data);
      setEvals(e.data || []);
      setCard(c.data);
      setSummary(s.data);
      setMetricsPack(m.data || { metrics: [], milestones: [] });
      setAwards(aw.data || []);
      setPendingMedia(pm.data || []);
      setMedia(Array.isArray(md.data) ? md.data : md.data?.media || []);
      setAssessments(Array.isArray(asmt.data) ? asmt.data : []);
      // Athlete/parent sessions read their own goals via /me/goals; staff-linked
      // accounts fall back to the staff route. Priorities degrade to lowest
      // category scores when neither is readable. Never fabricate goal data.
      api.get("/me/goals")
        .then((g) => setGoals(Array.isArray(g.data) ? g.data : []))
        .catch(() =>
          api.get(`/athletes/${a.data.id}/goals`)
            .then((g) => setGoals(Array.isArray(g.data) ? g.data : []))
            .catch(() => setGoals([])));
    }).catch((err) => toast.error(errMsg(err)));
  };

  useEffect(reload, []);

  const togglePublic = async (on) => {
    try {
      await api.patch("/me/athlete", { public_enabled: on });
      toast.success(on ? "Public ID Story enabled." : "Story is private again.");
      reload();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const resolveConsent = async (mediaId, approve) => {
    try {
      await api.post(`/media/${mediaId}/consent`, { approve });
      toast.success(approve ? "Media approved." : "Media rejected.");
      reload();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!athlete) {
    return <div className="space-y-3"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>;
  }

  const cats = summary?.category_scores || {};
  const radarData = Object.entries(cats).map(([name, d]) => ({ category: name, score: d.score }));
  const ranked = Object.entries(cats)
    .filter(([, d]) => d?.score != null)
    .sort((x, y) => y[1].score - x[1].score);
  const strengths = ranked.slice(0, 3);
  const needs = ranked.slice(-2).reverse().filter(([name]) => !strengths.some(([s]) => s === name));

  const permanentId = formatPermanentId(card?.athlete_id || athlete.id);
  const completion = computeProfileCompletion(athlete, summary, media);
  const scored = evals.filter((ev) => ev.computed?.overall_score != null);
  const currentScore = summary?.latest_overall ?? card?.headline_overall ?? scored[0]?.computed?.overall_score ?? null;
  const lastEvaluated = (scored[0]?.event_date || scored[0]?.submitted_at || evals[0]?.event_date || evals[0]?.submitted_at || "").slice(0, 10);
  const metrics = metricsPack.metrics || [];
  const sourceByKey = metrics.reduce((acc, m) => {
    if (!(m.metric_key in acc)) acc[m.metric_key] = metricSource(m);
    return acc;
  }, {});

  // Development KPI — first vs latest scored evaluation. /me/evaluations has no
  // season_id, so "this season" is only claimed when both endpoints of the
  // window fall in the latest evaluation's calendar year; otherwise the copy
  // says "since your first evaluation". With <2 scored evals there is no trend.
  const evalDay = (ev) => (ev.event_date || ev.submitted_at || "").slice(0, 10);
  const scoredAsc = [...scored].reverse(); // API returns newest-first
  const latestScoredYear = scoredAsc.length ? evalDay(scoredAsc[scoredAsc.length - 1]).slice(0, 4) : null;
  const seasonScored = scoredAsc.filter((ev) => evalDay(ev).slice(0, 4) === latestScoredYear);
  const devWindow = seasonScored.length >= 2 ? seasonScored : scoredAsc;
  const devIsSeason = seasonScored.length >= 2;
  const devBase = devWindow.length >= 2 ? Number(devWindow[0].computed.overall_score) : null;
  const devLatest = devWindow.length >= 2 ? Number(devWindow[devWindow.length - 1].computed.overall_score) : null;
  const change = devBase != null ? Math.round((devLatest - devBase) * 10) / 10 : null;
  const devPct = change != null && devBase > 0 ? Math.round((change / devBase) * 100) : null;
  const devWindowLabel = devIsSeason ? "this season" : "since your first evaluation";
  const devHeadline = change == null
    ? (scored.length === 1
        ? "Baseline set — your development trend starts with your next evaluation."
        : "First evaluation coming up — that's where your development story starts.")
    : `${devPct != null ? `${devPct > 0 ? "+" : ""}${devPct}%` : `${change > 0 ? "+" : ""}${change}`} development ${devWindowLabel}`;

  // Top 3 priorities — active coach goals, worst status first, nearest target
  // date breaking ties. Everything past three stays behind "View all goals".
  const activeGoals = goals
    .filter((g) => g.status !== "Completed" && g.status !== "Archived")
    .sort((x, y) =>
      (PRIORITY_STATUS_RANK[x.status] ?? 9) - (PRIORITY_STATUS_RANK[y.status] ?? 9) ||
      (x.target_date || "9999").localeCompare(y.target_date || "9999"));
  const topPriorities = activeGoals.slice(0, 3);
  const moreGoals = activeGoals.slice(3);
  // No goals visible (athlete sessions can't read the staff goals list): fall
  // back to the three lowest evaluation categories — focus areas, no invented targets.
  const focusFallback = topPriorities.length === 0
    ? ranked.slice(-3).reverse().filter(([name]) => !strengths.some(([s]) => s === name))
    : [];

  // Personal bests — best verified value per metric key; lower_better decides direction.
  const pbByKey = {};
  for (const m of metrics) {
    const v = Number(m.value);
    if (m.value == null || Number.isNaN(v)) continue;
    const cur = pbByKey[m.metric_key];
    if (!cur || (m.lower_better ? v < Number(cur.value) : v > Number(cur.value))) pbByKey[m.metric_key] = m;
  }
  const personalBests = PB_KEY_ORDER.filter((k) => pbByKey[k]).map((k) => pbByKey[k]).slice(0, 4);

  // What's next — only real dates from the payload; the card is omitted when
  // neither an upcoming evaluation date nor a goal check-in exists.
  const today = new Date().toISOString().slice(0, 10);
  const nextEvalDate = evals.map((ev) => ev.next_evaluation_date).filter((d) => d && d >= today).sort()[0] || null;
  const nextGoalDate = activeGoals.map((g) => g.follow_up_date || g.target_date).filter((d) => d && d >= today).sort()[0] || null;

  const qrUrl = card?.qr_payload
    ? `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(card.qr_payload)}`
    : null;

  const TrendIcon = change > 0 ? TrendingUp : change < 0 ? TrendingDown : Minus;
  const trendTone = change > 0 ? "text-success" : change < 0 ? "text-destructive" : "text-muted-foreground";
  const trendLabel = change == null ? "Not enough history" : change > 0 ? "Improving" : change < 0 ? "Slipping" : "Holding steady";

  return (
    <div className="space-y-5 max-w-3xl" data-testid="my-id-page">
      {/* Hero — who you are, score, trend, last evaluated (§25) */}
      <Card className="rounded-2xl border-border overflow-hidden" data-testid="my-id-hero">
        <div className="hero-sweep px-5 py-6">
          <div className="flex flex-col sm:flex-row gap-5">
            <PlayerAvatar firstName={athlete.first_name} lastName={athlete.last_name} size="hero" photoUrl={athlete.photo_url} />
            <div className="flex-1 min-w-0 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-widest text-brand font-semibold">My Development</p>
                  <h1 className="font-display text-4xl sm:text-5xl text-foreground mt-1">
                    {athlete.first_name} {athlete.last_name}
                  </h1>
                  <p className="text-sm font-mono-num text-brand mt-1" data-testid="my-id-permanent-id">{permanentId}</p>
                </div>
                <Button asChild className="rounded-xl bg-primary hover:bg-brand-secondary h-11">
                  <Link to="/my-id/edit" data-testid="my-id-edit-link"><Pencil className="h-4 w-4 mr-1.5" /> Edit</Link>
                </Button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
                <div><p className="text-[10px] uppercase text-muted-foreground">Age group</p><p className="font-semibold">{athlete.age_group || "—"}</p></div>
                <div><p className="text-[10px] uppercase text-muted-foreground">Primary</p><p className="font-semibold">{athlete.primary_position || "—"}</p></div>
                <div><p className="text-[10px] uppercase text-muted-foreground">Grad year</p><p className="font-semibold">{card?.graduation_year || athlete.graduation_year || "—"}</p></div>
                <div><p className="text-[10px] uppercase text-muted-foreground">Bats / Throws</p><p className="font-semibold">{(card?.bats || athlete.bats) || "—"} / {(card?.throws || athlete.throws) || "—"}</p></div>
                <div><p className="text-[10px] uppercase text-muted-foreground">Height / Weight</p><p className="font-semibold">{athlete.height || "—"} / {athlete.weight || "—"}</p></div>
                <div><p className="text-[10px] uppercase text-muted-foreground">Last evaluated</p><p className="font-semibold font-mono-num">{lastEvaluated || "—"}</p></div>
              </div>
            </div>
          </div>
        </div>
        {/* Development leads — the headline the athlete reads before any score. */}
        <div className="px-5 py-3 border-t border-divider flex items-center gap-2.5" data-testid="my-dev-headline">
          <TrendIcon className={`h-6 w-6 shrink-0 ${trendTone}`} />
          <p className={`font-display text-lg sm:text-xl uppercase tracking-wide ${change != null ? trendTone : "text-muted-foreground"}`}>
            {devHeadline}
          </p>
        </div>
        <CardContent className="py-4 border-t border-divider grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div data-testid="my-dev-kpi">
            <p className={`text-3xl font-bold font-mono-num flex items-center justify-center gap-1 ${trendTone}`}>
              <TrendIcon className="h-5 w-5" />
              {change != null ? `${change > 0 ? "+" : ""}${change}` : "—"}
            </p>
            <p className="text-[10px] uppercase text-muted-foreground mt-1">{trendLabel}</p>
          </div>
          <div>
            <p className="text-3xl font-bold font-mono-num text-brand" data-testid="my-id-overall">{currentScore ?? "—"}</p>
            <p className="text-[10px] uppercase text-muted-foreground mt-1">Overall score</p>
          </div>
          <div>
            <p className="text-3xl font-bold font-mono-num">{summary?.evaluation_count ?? evals.length}</p>
            <p className="text-[10px] uppercase text-muted-foreground mt-1">Evaluations</p>
          </div>
          <div>
            <p className="text-3xl font-bold font-mono-num">{metrics.length}</p>
            <p className="text-[10px] uppercase text-muted-foreground mt-1">Verified metrics</p>
          </div>
        </CardContent>
      </Card>

      {/* Top 3 current priorities — never the full weakness list (client direction) */}
      {(topPriorities.length > 0 || focusFallback.length > 0) && (
        <Card className="rounded-2xl border-border" data-testid="my-dev-priorities">
          <CardContent className="py-4 space-y-3">
            <div>
              <p className="font-semibold text-sm flex items-center gap-2">
                <Target className="h-4 w-4 text-brand" /> {(topPriorities.length || focusFallback.length) >= 3 ? "My top 3 current priorities" : "My current priorities"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">What you're working on right now — not everything at once.</p>
            </div>
            {topPriorities.map((g, i) => (
              <div key={g.id} className="rounded-xl border border-border bg-card px-4 py-3 flex gap-3" data-testid={`my-dev-priority-${i + 1}`}>
                <span className="font-display text-2xl text-brand leading-none pt-0.5">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold text-sm uppercase tracking-wide">{g.title}</p>
                    {g.status && (
                      <span className={`text-[10px] uppercase tracking-wide border rounded-full px-2 py-0.5 ${goalStatusTone(g.status)}`}>{g.status}</span>
                    )}
                  </div>
                  {g.starting_point && g.target ? (
                    <p className="font-mono-num text-lg font-bold mt-1">
                      {g.starting_point} <span className="text-muted-foreground font-normal">→</span> <span className="text-brand">Target {g.target}</span>
                    </p>
                  ) : (
                    <div className="mt-2 space-y-1">
                      <Progress value={g.progress || 0} className="h-2" />
                      <p className="text-xs text-muted-foreground font-mono-num">{g.progress || 0}% to goal</p>
                    </div>
                  )}
                  {g.target_date && <p className="text-xs text-muted-foreground mt-1 font-mono-num">Target date: {g.target_date}</p>}
                </div>
              </div>
            ))}
            {/* Athlete sessions can't read coach goals yet — focus areas from the latest evaluation, no invented targets. */}
            {topPriorities.length === 0 && focusFallback.map(([name, d], i) => (
              <div key={name} className="rounded-xl border border-border bg-card px-4 py-3 flex gap-3" data-testid={`my-dev-priority-${i + 1}`}>
                <span className="font-display text-2xl text-brand leading-none pt-0.5">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold text-sm uppercase tracking-wide">{name}</p>
                    <span className="font-mono-num font-semibold text-warning">{d.score}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Focus area from your latest evaluation — your coach hasn't set a target yet.</p>
                </div>
              </div>
            ))}
            {moreGoals.length > 0 && (
              <Accordion type="single" collapsible>
                <AccordionItem value="all-goals" className="border-b-0">
                  <AccordionTrigger className="text-sm py-2" data-testid="my-dev-all-goals-toggle">View all goals ({activeGoals.length})</AccordionTrigger>
                  <AccordionContent className="space-y-2">
                    {moreGoals.map((g) => (
                      <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 text-sm border-b border-divider pb-2 last:border-0">
                        <span className="font-semibold">{g.title}</span>
                        <span className="text-xs text-muted-foreground">{g.status}{g.progress != null ? ` · ${g.progress}%` : ""}</span>
                      </div>
                    ))}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
          </CardContent>
        </Card>
      )}

      {/* Personal bests — verified numbers only, never invented */}
      {personalBests.length > 0 && (
        <Card className="rounded-2xl border-border" data-testid="my-dev-personal-bests">
          <CardContent className="py-4 space-y-3">
            <p className="font-semibold text-sm flex items-center gap-2">
              <Trophy className="h-4 w-4 text-brand" /> Personal bests
            </p>
            <div className="flex flex-wrap gap-2">
              {personalBests.map((m) => (
                <span key={m.metric_key} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">{m.label || m.metric_key.replace(/_/g, " ")}</span>
                  <span className="font-mono-num font-bold">{m.value}{m.unit ? ` ${m.unit}` : ""}</span>
                  <VerificationBadge source={metricSource(m)} compact />
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* What's next — only rendered when a real upcoming date exists in the payload */}
      {(nextEvalDate || nextGoalDate) && (
        <Card className="rounded-2xl border-border" data-testid="my-dev-whats-next">
          <CardContent className="py-4 flex items-center gap-3">
            <CalendarClock className="h-5 w-5 text-brand shrink-0" />
            <div>
              <p className="font-semibold text-sm">What's next</p>
              {nextEvalDate && <p className="text-sm text-muted-foreground">Next evaluation: <span className="font-mono-num font-semibold text-foreground">{nextEvalDate}</span></p>}
              {!nextEvalDate && nextGoalDate && <p className="text-sm text-muted-foreground">Next goal check-in: <span className="font-mono-num font-semibold text-foreground">{nextGoalDate}</span></p>}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Profile completion — same definition staff sees */}
      <Card className="rounded-2xl border-border" data-testid="my-id-completion">
        <CardContent className="py-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Profile completion</p>
              <p className="text-xs text-muted-foreground">
                {completion.missing.length === 0 ? "Everything scouts look for is on file." : `Missing: ${completion.missing.join(" · ")}`}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <p className="text-2xl font-bold font-mono-num text-brand">{completion.pct}%</p>
              {completion.missing.length > 0 && (
                <Button asChild variant="outline" className="rounded-xl shrink-0 border-brand text-brand">
                  <Link to="/my-id/edit">Finish</Link>
                </Button>
              )}
            </div>
          </div>
          <Progress value={completion.pct} className="h-3" />
        </CardContent>
      </Card>

      {pendingMedia.length > 0 && (
        <Card className="rounded-2xl border-warning/40 bg-warning/10">
          <CardContent className="py-4 space-y-2">
            <p className="text-sm font-semibold text-warning">Media awaiting your consent</p>
            {pendingMedia.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{m.file_type} · {m.description || "Upload"}</span>
                <div className="flex gap-2">
                  <Button size="sm" className="rounded-lg h-8" onClick={() => resolveConsent(m.id, true)}>Approve</Button>
                  <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => resolveConsent(m.id, false)}>Reject</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ID Card */}
      <Card className="rounded-2xl border-border overflow-hidden" data-testid="id-card">
        <div className="hero-sweep px-5 py-5 flex flex-wrap gap-4 items-center">
          <PlayerAvatar firstName={athlete.first_name} lastName={athlete.last_name} size="lg" photoUrl={athlete.photo_url} />
          <div className="flex-1 min-w-[160px]">
            <p className="font-display text-2xl text-foreground">{card?.name}</p>
            <p className="text-sm text-muted-foreground">{card?.primary_position} · {card?.age_group}</p>
            <p className="text-xs font-mono-num text-brand mt-0.5" data-testid="id-card-permanent-id">{permanentId}</p>
            <p className="text-3xl font-bold font-mono-num text-brand mt-2">{card?.headline_overall ?? "—"}</p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Headline overall</p>
            {(card?.highlight_metrics || []).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {card.highlight_metrics.map((h) => (
                  <span key={h.key} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs font-mono-num">
                    {h.label}: {h.value}{h.unit ? ` ${h.unit}` : ""}
                    <VerificationBadge source={sourceByKey[h.key]} compact />
                  </span>
                ))}
              </div>
            )}
          </div>
          {qrUrl && (
            <div className="text-center">
              <img src={qrUrl} alt="ID QR" className="rounded-xl border border-border bg-white p-1 w-28 h-28 mx-auto" data-testid="id-card-qr" />
              <p className="text-[10px] text-muted-foreground mt-1 max-w-[8rem]">Scan for ID Story</p>
            </div>
          )}
        </div>
        <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3 border-t border-divider">
          <div className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-brand" />
            <div>
              <p className="text-sm font-semibold">Public ID Story</p>
              <p className="text-xs text-muted-foreground">Parents can open your share link when enabled.</p>
            </div>
          </div>
          <Switch checked={!!card?.public_enabled} onCheckedChange={togglePublic} data-testid="public-story-toggle" />
          {card?.story_url && (
            <a href={card.story_url} target="_blank" rel="noreferrer" className="text-xs text-info hover:underline w-full truncate" data-testid="story-link">
              {card.story_url}
            </a>
          )}
        </CardContent>
      </Card>

      {/* Strengths and development needs */}
      {(strengths.length > 0 || needs.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="my-id-strengths-needs">
          <Card className="rounded-2xl border-border">
            <CardContent className="py-4 space-y-2">
              <p className="font-semibold text-sm flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand" /> Strongest skills</p>
              {strengths.length === 0 ? (
                <p className="text-sm text-muted-foreground">Fills in after your first evaluation.</p>
              ) : strengths.map(([name, d]) => (
                <div key={name} className="flex items-center justify-between text-sm">
                  <span>{name}</span>
                  <span className="font-mono-num font-semibold text-success">{d.score}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="rounded-2xl border-border">
            <CardContent className="py-4 space-y-2">
              <p className="font-semibold text-sm flex items-center gap-2"><Target className="h-4 w-4 text-brand" /> Development needs</p>
              {needs.length === 0 ? (
                <p className="text-sm text-muted-foreground">Fills in after your first evaluation.</p>
              ) : needs.map(([name, d]) => (
                <div key={name} className="flex items-center justify-between text-sm">
                  <span>{name}</span>
                  <span className="font-mono-num font-semibold text-warning">{d.score}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* 60'6" Development Assessment — published coach-approved AI assessments
          only; the section disappears entirely when there are none. */}
      {assessments.length > 0 && (
        <div className="space-y-3" data-testid="my-assessments-section">
          <p className="font-semibold text-sm text-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand" /> 60&apos;6&quot; Development Assessment
          </p>
          {assessments.map((asmt, i) => (
            <Card key={asmt.id || i} className="rounded-2xl border-border">
              <CardContent className="py-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-foreground">{asmt.event_name || "Event"}</p>
                    <p className="text-xs text-muted-foreground">{asmt.event_date || "—"}</p>
                  </div>
                  {asmt.published_at && (
                    <p className="text-xs text-muted-foreground shrink-0">Published {String(asmt.published_at).slice(0, 10)}</p>
                  )}
                </div>
                <AssessmentContent content={asmt.content} finalComment={asmt.final_comment} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="rounded-2xl border-border bg-card">
        <CardContent className="pt-4 pb-2">
          <p className="font-semibold text-sm text-foreground mb-1 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-brand" /> Skill radar
          </p>
          {radarData.length >= 3 ? (
            <IdRadarChart data={radarData} />
          ) : (
            <p className="text-sm text-muted-foreground py-10 text-center">
              Your radar fills in after coaches submit evaluations.
            </p>
          )}
        </CardContent>
      </Card>

      {metrics.length > 0 && (
        <Card className="rounded-2xl border-border" data-testid="my-id-metrics">
          <CardContent className="pt-4 pb-4">
            <p className="font-semibold text-sm mb-3">Measurements</p>
            <div className="space-y-2">
              {metrics.slice(0, 10).map((m) => (
                <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-sm border-b border-divider pb-2 last:border-0">
                  <span className="text-muted-foreground capitalize">{m.metric_key.replace(/_/g, " ")}</span>
                  <div className="flex items-center gap-2">
                    <VerificationBadge source={metricSource(m)} compact />
                    <span className="font-mono-num font-semibold">{m.value} {m.unit}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Long-form detail stays collapsed (§23) */}
      {(athlete.bio || ranked.length > 0 || (metricsPack.milestones || []).length > 0 || awards.length > 0) && (
        <Card className="rounded-2xl border-border">
          <CardContent className="py-0">
            <Accordion type="single" collapsible>
              <AccordionItem value="details" className="border-b-0">
                <AccordionTrigger data-testid="my-id-details-toggle">View Details</AccordionTrigger>
                <AccordionContent className="space-y-4">
                  {athlete.bio && (
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground mb-1">About</p>
                      <p className="text-sm text-muted-foreground">{athlete.bio}</p>
                    </div>
                  )}
                  {ranked.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase text-muted-foreground">All category scores</p>
                      {ranked.map(([name, d]) => (
                        <div key={name} className="flex justify-between text-sm border-b border-divider pb-1 last:border-0">
                          <span>{name}</span>
                          <span className="font-mono-num font-semibold">{d.score}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {(metricsPack.milestones || []).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] uppercase text-muted-foreground flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5 text-brand" /> Milestones</p>
                      {metricsPack.milestones.slice(0, 8).map((ms) => (
                        <div key={ms.id} className="text-sm border-b border-divider pb-2 last:border-0">
                          <p className="font-semibold">{ms.label}</p>
                          <p className="text-xs text-muted-foreground">{ms.detail}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {awards.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase text-muted-foreground">Awards</p>
                      {awards.map((a) => (
                        <div key={a.id} className="text-sm flex justify-between gap-2">
                          <span>{a.title}</span>
                          <span className="text-xs text-muted-foreground capitalize">{a.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>
      )}

      <div>
        <p className="font-semibold text-sm text-foreground mb-2">Evaluation timeline</p>
        {evals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No submitted evaluations yet.</p>
        ) : (
          <div className="space-y-2">
            {evals.map((ev) => (
              <div key={ev.id} className="rounded-xl border border-border bg-card px-4 py-3 flex justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">{ev.event_name || "Event"}</p>
                  <p className="text-xs text-muted-foreground">{ev.station_name} · {ev.event_date || "—"}</p>
                </div>
                <p className="font-mono-num font-bold text-lg text-brand">
                  {ev.computed?.overall_score ?? "—"}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
