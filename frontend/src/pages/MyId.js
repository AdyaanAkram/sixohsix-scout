import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errMsg, setToken } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatPermanentId } from "@/lib/utils";
import { IdRadarChart } from "@/components/common/IdRadarChart";
import { AssessmentContent } from "@/components/common/AssessmentContent";
import { resolvePhotoSrc } from "@/components/common/PlayerAvatar";
import { VerificationBadge, isVerifiedSource } from "@/components/common/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  CalendarClock,
  ClipboardCheck,
  Film,
  Minus,
  Pencil,
  Plus,
  Ruler,
  Share2,
  Shield,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";

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

/* Timed events: a smaller number is the better number. The payload usually carries
   lower_better, but imported rows often don't — fall back to the known keys rather
   than silently calling a slow time a personal best. */
const LOWER_IS_BETTER = new Set(["sixty_yard_dash", "sixty_yard", "60_yard_dash", "home_to_first", "pop_time", "ten_yd"]);
const lowerBetter = (m) => (m?.lower_better != null ? Boolean(m.lower_better) : LOWER_IS_BETTER.has(m?.metric_key));

const metricLabel = (m) => m?.label || String(m?.metric_key || "").replace(/_/g, " ");

/* Goal statuses that still need work, worst-first — drives the top-3 pick. */
const PRIORITY_STATUS_RANK = { "Needs Attention": 0, "Active": 1, "Improving": 2, "Not Started": 3 };

const goalStatusTone = (status) =>
  status === "Needs Attention" ? "text-warning border-warning/40"
    : status === "Improving" ? "text-success border-success/40"
    : "text-muted-foreground border-border";

/* Tiny uppercase panel header — the card anatomy every other page in the app uses. */
const PanelLabel = ({ children }) => (
  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>
);

/* Tinted stat tile (ReviewQueue idiom): icon square, mono value, tiny label, sub. */
const StatTile = ({ icon: Icon, tint, value, label, sub, badge, testId }) => (
  <div className="rounded-2xl border border-border bg-card p-3" data-testid={testId}>
    <div className="flex items-start gap-2.5">
      <div className={`h-10 w-10 rounded-lg grid place-items-center shrink-0 ${tint}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono-num text-2xl font-bold leading-none text-foreground">{value}</span>
          {badge}
        </div>
        <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  </div>
);

/* One measured number, chip-sized: what the athlete is proudest of. */
const MeasurementChip = ({ m, testId }) => (
  <div className="min-w-0 rounded-xl border border-border bg-card px-3 py-2.5" data-testid={testId}>
    <div className="flex items-center gap-1.5">
      <p className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {metricLabel(m)}
      </p>
      <VerificationBadge source={metricSource(m)} iconOnly />
    </div>
    <div className="mt-1 flex items-baseline gap-1">
      <span className="font-mono-num text-2xl font-bold leading-none text-foreground">{m.value}</span>
      {m.unit && <span className="truncate text-xs text-muted-foreground">{m.unit}</span>}
    </div>
  </div>
);

/* Photo header, same idiom as the roster card: the real photo when the athlete has
   one, otherwise a branded monogram panel with a faded position watermark — a
   photo-less family should still see something that looks made for them. */
const CardPhoto = ({ p }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [p?.photo_url]);
  const src = !failed ? resolvePhotoSrc(p?.photo_url) : null;
  if (src) {
    return (
      <img
        src={src}
        alt={`${p?.first_name || ""} ${p?.last_name || ""}`.trim() || "Player"}
        className="h-full w-full object-cover object-top"
        onError={() => setFailed(true)}
      />
    );
  }
  const initials = `${(p?.first_name || "?")[0] || ""}${(p?.last_name || "")[0] || ""}`.toUpperCase();
  return (
    <div className="relative flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-tertiary via-secondary to-background">
      {p?.primary_position && (
        <span className="absolute -right-2 bottom-0 select-none font-display text-7xl font-extrabold leading-none text-foreground/[0.06]">
          {p.primary_position}
        </span>
      )}
      <span className="select-none font-display text-5xl text-brand/70">{initials}</span>
    </div>
  );
};

/* Families who self-signed up without a code live in the shared 60'6" Player
   Registry org until they join a real club. POST /auth/join returns a NEW token
   scoped to the joined org — store it and hard-reload so every query refetches. */
const JoinClubCard = ({ prominent }) => {
  const [code, setCode] = useState("");
  const [open, setOpen] = useState(prominent);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    try {
      const r = await api.post("/auth/join", { join_code: code.trim() });
      setToken(r.data.token); // switches this session into the joined org
      toast.success(`Joined ${r.data.organization_name} — pending coach approval`);
      window.location.reload();
    } catch (e2) {
      toast.error(errMsg(e2));
      setBusy(false);
    }
  };

  if (!prominent && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-info hover:underline"
        data-testid="join-code-open"
      >
        Have another club code?
      </button>
    );
  }

  const form = (
    <form onSubmit={submit} className="flex flex-wrap gap-2">
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Enter club join code"
        className="h-11 min-w-0 flex-1 rounded-xl font-mono"
        data-testid="join-code-input"
      />
      <Button
        type="submit"
        disabled={busy || !code.trim()}
        className="h-11 rounded-xl bg-primary hover:bg-brand-secondary"
        data-testid="join-code-submit"
      >
        {busy ? "Joining…" : "Join"}
      </Button>
    </form>
  );

  if (!prominent) {
    return (
      <Card className="rounded-2xl border-border bg-card">
        <CardContent className="pt-4 pb-4 space-y-2">
          <PanelLabel>Join another club</PanelLabel>
          <p className="text-xs text-muted-foreground">Got a code from a new coach? Add it here.</p>
          {form}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl border-brand/50 bg-brand-tertiary/40" data-testid="join-club-card">
      <CardContent className="py-5 space-y-3">
        <div className="flex items-start gap-3">
          <Shield className="mt-0.5 h-6 w-6 shrink-0 text-brand" />
          <div className="min-w-0">
            <p className="font-display text-2xl text-foreground">Join your club</p>
            <p className="text-sm text-muted-foreground">
              Got a join code from your coach? Enter it here to connect this ID to your club&apos;s roster.
            </p>
          </div>
        </div>
        {form}
      </CardContent>
    </Card>
  );
};

const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "UTIL"];

const EMPTY_CHILD = {
  first_name: "", last_name: "", date_of_birth: "", graduation_year: "",
  primary_position: "", bats: "", throws: "",
};

/* "+ Add child" — creates the athlete in the shared registry org, linked to
   this account as guardian. They join a club/event afterwards through a
   registration link or join code, like any registry athlete. */
const AddChildDialog = ({ open, onOpenChange, onAdded }) => {
  const [form, setForm] = useState(EMPTY_CHILD);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const canSubmit = form.first_name.trim() && form.last_name.trim() && form.date_of_birth && form.graduation_year;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      const payload = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        date_of_birth: form.date_of_birth,
        graduation_year: Number(form.graduation_year),
      };
      if (form.primary_position) payload.primary_position = form.primary_position;
      if (form.bats) payload.bats = form.bats;
      if (form.throws) payload.throws = form.throws;
      const r = await api.post("/me/athletes", payload);
      toast.success("Added — register them for an event with your club's link or join code");
      setForm(EMPTY_CHILD);
      onOpenChange(false);
      onAdded(r.data);
    } catch (e2) {
      toast.error(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="add-child-dialog">
        <DialogHeader>
          <DialogTitle>Add a child</DialogTitle>
          <DialogDescription>
            They start in the 60&apos;6&quot; Player Registry — register them for an event with
            your club&apos;s link or join code.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="add-child-first">First name</Label>
              <Input id="add-child-first" value={form.first_name} onChange={(e) => set("first_name")(e.target.value)} data-testid="add-child-first-name" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="add-child-last">Last name</Label>
              <Input id="add-child-last" value={form.last_name} onChange={(e) => set("last_name")(e.target.value)} data-testid="add-child-last-name" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="add-child-dob">Date of birth</Label>
              <Input id="add-child-dob" type="date" value={form.date_of_birth} onChange={(e) => set("date_of_birth")(e.target.value)} data-testid="add-child-dob" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="add-child-grad">Grad year</Label>
              <Input id="add-child-grad" type="number" min="2024" max="2045" value={form.graduation_year} onChange={(e) => set("graduation_year")(e.target.value)} data-testid="add-child-grad-year" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Primary position</Label>
              <Select value={form.primary_position} onValueChange={set("primary_position")}>
                <SelectTrigger data-testid="add-child-position"><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>{POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Bats</Label>
              <Select value={form.bats} onValueChange={set("bats")}>
                <SelectTrigger data-testid="add-child-bats"><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>{["R", "L", "S"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Throws</Label>
              <Select value={form.throws} onValueChange={set("throws")}>
                <SelectTrigger data-testid="add-child-throws"><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>{["R", "L"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!canSubmit || busy} className="rounded-xl bg-primary hover:bg-brand-secondary" data-testid="add-child-submit">
              {busy ? "Adding…" : "Add child"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default function MyId() {
  const { user } = useAuth();
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
  // Multi-child families: every linked athlete (any org) + the selected one.
  // Endpoint may not be deployed yet — any failure hides the switcher entirely.
  const [myAthletes, setMyAthletes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [addChildOpen, setAddChildOpen] = useState(false);

  const reload = (athleteId = selectedId) => {
    // Selecting a child scopes every /me/* call; null/undefined omits the
    // param and the backend falls back to the first linked athlete.
    const params = athleteId ? { athlete_id: athleteId } : undefined;
    Promise.all([
      api.get("/me/athlete", { params }),
      api.get("/me/evaluations", { params }),
      api.get("/me/id-card", { params }),
      api.get("/me/summary", { params }),
      api.get("/me/metrics", { params }).catch(() => ({ data: { metrics: [], milestones: [] } })),
      api.get("/me/awards", { params }).catch(() => ({ data: [] })),
      api.get("/media/pending-consent").catch(() => ({ data: [] })),
      // Consent-approved media only — also feeds the "approved video" completion check.
      api.get("/me/media", { params }).catch(() => ({ data: [] })),
      // Published AI assessments only — the section renders nothing when empty.
      // Returns ALL the family's published recaps by design (left unscoped).
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
      api.get("/me/goals", { params })
        .then((g) => setGoals(Array.isArray(g.data) ? g.data : []))
        .catch(() =>
          api.get(`/athletes/${a.data.id}/goals`)
            .then((g) => setGoals(Array.isArray(g.data) ? g.data : []))
            .catch(() => setGoals([])));
    }).catch((err) => toast.error(errMsg(err)));
  };

  const loadAthletes = () =>
    api.get("/me/athletes")
      .then((r) => {
        const list = Array.isArray(r.data) ? r.data : [];
        setMyAthletes(list);
        return list;
      })
      .catch(() => {
        setMyAthletes([]);
        return [];
      });

  // Family list first, then the selected child's data — selecting an id kicks
  // off the data load; accounts with no listable athletes keep the old
  // "default athlete" load path (and its 404 handling) unchanged.
  useEffect(() => {
    loadAthletes().then((list) => {
      if (list.length > 0) setSelectedId(list[0].id);
      else reload(null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) reload(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // After adding a child: refresh the family list, then switch to the new kid
  // (the selection change reloads every section for them).
  const handleChildAdded = (child) => {
    loadAthletes().then(() => {
      if (child?.id && child.id !== selectedId) setSelectedId(child.id);
      else reload();
    });
  };

  const togglePublic = async (on) => {
    try {
      // athlete_id keeps the toggle on the SELECTED child, not the default one.
      await api.patch("/me/athlete", { public_enabled: on },
        selectedId ? { params: { athlete_id: selectedId } } : undefined);
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

  // ---- every hook is above this early return; nothing below may add one ----
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

  const firstName = athlete.first_name || "your athlete";
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
  // /me/metrics is newest-first, so the first row per key is the latest reading.
  const latestByKey = [];
  const seenKeys = new Set();
  for (const m of metrics) {
    if (m.value == null || seenKeys.has(m.metric_key)) continue;
    seenKeys.add(m.metric_key);
    latestByKey.push(m);
  }
  const verifiedCount = metrics.filter((m) => isVerifiedSource(metricSource(m))).length;
  const evaluationCount = summary?.evaluation_count ?? evals.length;

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
  // The headline used to look ONLY at scored evaluations, so an athlete with a
  // published assessment and measured results on file was still told "first
  // evaluation coming up" — directly contradicting the assessment card below it.
  const hasResults = evals.length > 0 || assessments.length > 0;
  const devHeadline = change == null
    ? (scored.length === 1
        ? "Baseline set — your development trend starts with your next evaluation."
        : hasResults
          ? "First results are in — your development trend builds from the next camp."
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

  // Personal bests — best verified value per metric key; timed events count down.
  const pbByKey = {};
  for (const m of metrics) {
    const v = Number(m.value);
    if (m.value == null || Number.isNaN(v)) continue;
    const cur = pbByKey[m.metric_key];
    if (!cur || (lowerBetter(m) ? v < Number(cur.value) : v > Number(cur.value))) pbByKey[m.metric_key] = m;
  }
  const personalBests = PB_KEY_ORDER.filter((k) => pbByKey[k]).map((k) => pbByKey[k]).slice(0, 4);
  const sixtyKey = Object.keys(pbByKey).find((k) => /^(sixty|60)[_-]?(yard|yd)/.test(k));
  const best60 = sixtyKey ? pbByKey[sixtyKey] : null;

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

  // Identity line under the name — only facts we actually have, never a bare dash.
  const battingLine = athlete.bats && athlete.throws
    ? `Bats ${athlete.bats} · Throws ${athlete.throws}`
    : athlete.bats ? `Bats ${athlete.bats}` : athlete.throws ? `Throws ${athlete.throws}` : null;
  const gradYear = card?.graduation_year || athlete.graduation_year;
  const identityBits = [
    gradYear ? `Class of ${gradYear}` : athlete.age_group || null,
    athlete.primary_position || null,
    battingLine,
  ].filter(Boolean);
  const heroFacts = [
    gradYear && athlete.age_group ? { label: "Age group", value: athlete.age_group } : null,
    athlete.height ? { label: "Height", value: athlete.height } : null,
    athlete.weight ? { label: "Weight", value: athlete.weight } : null,
    lastEvaluated ? { label: "Last seen by coaches", value: lastEvaluated } : null,
  ].filter(Boolean);

  // Still in the shared registry org → joining a real club is the headline action.
  const inRegistry =
    user?.organization_id === "org-606-registry" ||
    user?.organization_name === "60'6\" Player Registry";

  const hasDetails = Boolean(athlete.bio) || ranked.length > 0 || awards.length > 0 || metrics.length > 0;
  const milestones = metricsPack.milestones || [];

  return (
    <div className="space-y-4" data-testid="my-id-page">
      {/* Multi-child switcher — one pill per kid, everything below follows the
          selection. Single-child families see the page exactly as before. */}
      {myAthletes.length > 1 && (
        <div className="flex flex-wrap items-center gap-2" data-testid="my-child-switcher">
          {myAthletes.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedId(c.id)}
              data-testid={`my-child-pill-${c.id}`}
              className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
                c.id === selectedId
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:text-foreground hover:border-brand/60"
              }`}
            >
              {c.first_name}{c.last_name ? ` ${String(c.last_name)[0]}.` : ""}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAddChildOpen(true)}
            data-testid="my-add-child-pill"
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-4 py-1.5 text-sm font-semibold text-info hover:border-info"
          >
            <Plus className="h-3.5 w-3.5" /> Add child
          </button>
        </div>
      )}
      <AddChildDialog open={addChildOpen} onOpenChange={setAddChildOpen} onAdded={handleChildAdded} />

      {/* ---------------------------- HERO ---------------------------- */}
      <Card className="overflow-hidden rounded-2xl border-border" data-testid="my-id-hero">
        <div className="hero-sweep p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
            <div className="mx-auto h-36 w-36 shrink-0 overflow-hidden rounded-2xl ring-2 ring-brand/40 sm:mx-0 sm:h-44 sm:w-44">
              <CardPhoto p={athlete} />
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 basis-[220px]">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-brand">My 60&apos;6&quot; ID</p>
                  <h1 className="mt-1 break-words font-display text-3xl leading-tight text-foreground sm:text-4xl">
                    {athlete.first_name} {athlete.last_name}
                  </h1>
                  {identityBits.length > 0 && (
                    <p className="mt-1.5 break-words text-sm text-muted-foreground">{identityBits.join(" · ")}</p>
                  )}
                  {athlete.current_team && (
                    <p className="break-words text-sm text-muted-foreground">{athlete.current_team}</p>
                  )}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {verifiedCount > 0 && (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-success"
                      data-testid="my-id-verified-pill"
                    >
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> Verified by coaches
                    </span>
                  )}
                  <Button asChild className="h-11 rounded-xl bg-primary hover:bg-brand-secondary">
                    <Link to={selectedId ? `/my-id/edit?athlete_id=${selectedId}` : "/my-id/edit"} data-testid="my-id-edit-link"><Pencil className="mr-1.5 h-4 w-4" /> Edit</Link>
                  </Button>
                </div>
              </div>

              {/* The permanent ID, worn like an ID badge. */}
              <div className="inline-flex max-w-full flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-brand/40 bg-brand/10 px-3 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-brand/80">Permanent ID</span>
                <span className="break-all font-mono-num text-sm font-bold text-brand" data-testid="my-id-permanent-id">{permanentId}</span>
              </div>

              {heroFacts.length > 0 && (
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {heroFacts.map((f) => (
                    <div key={f.label} className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{f.label}</p>
                      <p className="break-words font-mono-num text-sm font-semibold text-foreground">{f.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Development leads — the headline the family reads before any score. */}
        <div className="flex items-center gap-2.5 border-t border-divider px-4 py-3 sm:px-6" data-testid="my-dev-headline">
          <TrendIcon className={`h-6 w-6 shrink-0 ${trendTone}`} />
          <p className={`min-w-0 font-display text-base uppercase tracking-wide sm:text-lg ${change != null ? trendTone : "text-muted-foreground"}`}>
            {devHeadline}
          </p>
        </div>
      </Card>

      {inRegistry && <JoinClubCard prominent />}

      {/* ------------------------ AT A GLANCE ------------------------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="my-id-glance">
        {metrics.length > 0 && (
          <StatTile
            icon={Ruler}
            tint="bg-brand/15 text-brand"
            value={metrics.length}
            label="Measurements"
            sub={verifiedCount > 0 ? `${verifiedCount} verified` : null}
            testId="my-glance-metrics"
          />
        )}
        {best60 && (
          <StatTile
            icon={Timer}
            tint="bg-success/15 text-success"
            value={best60.value}
            label="Best 60-yard"
            sub={best60.unit || "seconds"}
            badge={<VerificationBadge source={metricSource(best60)} iconOnly />}
            testId="my-glance-best-sixty"
          />
        )}
        {evaluationCount > 0 && (
          <StatTile
            icon={ClipboardCheck}
            tint="bg-[hsl(var(--info)_/_0.15)] text-info"
            value={evaluationCount}
            label="Evaluations"
            sub={lastEvaluated ? `Latest ${lastEvaluated}` : null}
            testId="my-glance-evaluations"
          />
        )}
      </div>

      {pendingMedia.length > 0 && (
        <Card className="rounded-2xl border-warning/40 bg-warning/10" data-testid="my-id-pending-media">
          <CardContent className="py-4 space-y-2">
            <p className="text-sm font-semibold text-warning">Photos and video waiting for your OK</p>
            {pendingMedia.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="min-w-0 text-muted-foreground">{m.file_type} · {m.description || "Upload"}</span>
                <div className="flex gap-2">
                  <Button size="sm" className="h-8 rounded-lg" onClick={() => resolveConsent(m.id, true)}>Approve</Button>
                  <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={() => resolveConsent(m.id, false)}>Reject</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* --------------------------- LAYOUT --------------------------- */}
      <div className="grid items-start gap-4 lg:grid-cols-3">
        {/* ---------------------- MAIN COLUMN ------------------------- */}
        <div className="min-w-0 space-y-4 lg:col-span-2">
          {/* The assessment tonight's email is about — top of the column. */}
          {assessments.length > 0 && (
            <div className="space-y-4" data-testid="my-assessments-section">
              {assessments.map((asmt, i) => (
                <Card key={asmt.id || i} className="overflow-hidden rounded-2xl border-brand/40 bg-card">
                  <div className="hero-sweep border-b border-divider px-4 py-4 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <div className="min-w-0 flex-1 basis-[220px]">
                        <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-brand">
                          <Sparkles className="h-3.5 w-3.5 shrink-0" /> 60&apos;6&quot; Development Assessment
                        </p>
                        <p className="mt-1 break-words font-display text-2xl text-foreground">
                          {asmt.event_name || "Your evaluation"}
                        </p>
                        {asmt.event_date && (
                          <p className="font-mono-num text-xs text-muted-foreground">{asmt.event_date}</p>
                        )}
                      </div>
                      {asmt.published_at && (
                        <p className="text-xs text-muted-foreground">Published {String(asmt.published_at).slice(0, 10)}</p>
                      )}
                    </div>
                  </div>
                  <CardContent className="space-y-3 pt-4 pb-4 leading-relaxed">
                    <AssessmentContent content={asmt.content} finalComment={asmt.final_comment} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* MY MEASUREMENTS — the centerpiece. Real numbers, verified at camps. */}
          <Card className="rounded-2xl border-border bg-card" data-testid="my-id-metrics">
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <PanelLabel>What coaches measured</PanelLabel>
                {verifiedCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-success">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> {verifiedCount} verified
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Every number here was taken by a coach at a 60&apos;6&quot; camp — nothing is estimated.
              </p>
              {latestByKey.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nothing here yet — this fills in after {firstName}&apos;s first camp.
                </p>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {latestByKey.map((m) => (
                    <MeasurementChip key={m.id || m.metric_key} m={m} testId={`my-measurement-${m.metric_key}`} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top 3 current priorities — never the full weakness list (client direction) */}
          {(topPriorities.length > 0 || focusFallback.length > 0) && (
            <Card className="rounded-2xl border-border bg-card" data-testid="my-dev-priorities">
              <CardContent className="space-y-3 pt-4 pb-4">
                <div>
                  <PanelLabel>What {firstName} is working on</PanelLabel>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {(topPriorities.length || focusFallback.length) >= 3
                      ? "Three things to focus on right now — not everything at once."
                      : "Focus areas right now — not everything at once."}
                  </p>
                </div>
                {topPriorities.map((g, i) => (
                  <div key={g.id} className="flex gap-3 rounded-xl border border-border bg-card px-4 py-3" data-testid={`my-dev-priority-${i + 1}`}>
                    <span className="pt-0.5 font-display text-2xl leading-none text-brand">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-bold uppercase tracking-wide">{g.title}</p>
                        {g.status && (
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${goalStatusTone(g.status)}`}>{g.status}</span>
                        )}
                      </div>
                      {g.starting_point && g.target ? (
                        <p className="mt-1 font-mono-num text-lg font-bold">
                          {g.starting_point} <span className="font-normal text-muted-foreground">→</span> <span className="text-brand">Target {g.target}</span>
                        </p>
                      ) : (
                        <div className="mt-2 space-y-1">
                          <Progress value={g.progress || 0} className="h-2" />
                          <p className="font-mono-num text-xs text-muted-foreground">{g.progress || 0}% to goal</p>
                        </div>
                      )}
                      {g.target_date && <p className="mt-1 font-mono-num text-xs text-muted-foreground">Target date: {g.target_date}</p>}
                    </div>
                  </div>
                ))}
                {/* Athlete sessions can't read coach goals yet — focus areas from the latest evaluation, no invented targets. */}
                {topPriorities.length === 0 && focusFallback.map(([name, d], i) => (
                  <div key={name} className="flex gap-3 rounded-xl border border-border bg-card px-4 py-3" data-testid={`my-dev-priority-${i + 1}`}>
                    <span className="pt-0.5 font-display text-2xl leading-none text-brand">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-bold uppercase tracking-wide">{name}</p>
                        <span className="font-mono-num font-semibold text-warning">{d.score}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        A focus area from the latest evaluation — no target set yet.
                      </p>
                    </div>
                  </div>
                ))}
                {moreGoals.length > 0 && (
                  <Accordion type="single" collapsible>
                    <AccordionItem value="all-goals" className="border-b-0">
                      <AccordionTrigger className="py-2 text-sm" data-testid="my-dev-all-goals-toggle">View all goals ({activeGoals.length})</AccordionTrigger>
                      <AccordionContent className="space-y-2">
                        {moreGoals.map((g) => (
                          <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-divider pb-2 text-sm last:border-0">
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

          {/* Strengths and development needs */}
          {(strengths.length > 0 || needs.length > 0) && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="my-id-strengths-needs">
              <Card className="min-w-0 rounded-2xl border-border bg-card">
                <CardContent className="space-y-2 pt-4 pb-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 shrink-0 text-brand" />
                    <PanelLabel>Strongest skills</PanelLabel>
                  </div>
                  {strengths.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Fills in after your first evaluation.</p>
                  ) : strengths.map(([name, d]) => (
                    <div key={name} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0">{name}</span>
                      <span className="font-mono-num font-semibold text-success">{d.score}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card className="min-w-0 rounded-2xl border-border bg-card">
                <CardContent className="space-y-2 pt-4 pb-4">
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 shrink-0 text-brand" />
                    <PanelLabel>Room to grow</PanelLabel>
                  </div>
                  {needs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Fills in after your first evaluation.</p>
                  ) : needs.map(([name, d]) => (
                    <div key={name} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0">{name}</span>
                      <span className="font-mono-num font-semibold text-warning">{d.score}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Personal bests — verified numbers only, never invented */}
          {personalBests.length > 0 && (
            <Card className="rounded-2xl border-border bg-card" data-testid="my-dev-personal-bests">
              <CardContent className="space-y-3 pt-4 pb-4">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 shrink-0 text-brand" />
                  <PanelLabel>Personal bests</PanelLabel>
                </div>
                <div className="flex flex-wrap gap-2">
                  {personalBests.map((m) => (
                    <span key={m.metric_key} className="inline-flex max-w-full items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm">
                      <span className="truncate text-xs capitalize text-muted-foreground">{metricLabel(m)}</span>
                      <span className="font-mono-num font-bold">{m.value}{m.unit ? ` ${m.unit}` : ""}</span>
                      <VerificationBadge source={metricSource(m)} iconOnly />
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Progress: the development trend and the overall score, honestly empty
              when there is nothing to show. */}
          <Card className="rounded-2xl border-border bg-card">
            <CardContent className="space-y-3 pt-4 pb-4">
              <PanelLabel>Progress over time</PanelLabel>
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0 rounded-xl border border-border bg-card px-3 py-3" data-testid="my-dev-kpi">
                  {change != null ? (
                    <p className={`flex items-center gap-1 font-mono-num text-3xl font-bold ${trendTone}`}>
                      <TrendIcon className="h-5 w-5 shrink-0" />
                      {`${change > 0 ? "+" : ""}${change}`}
                    </p>
                  ) : (
                    <p className="py-1 text-sm font-semibold text-muted-foreground">Not enough events yet</p>
                  )}
                  <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{trendLabel}</p>
                </div>
                <div className="min-w-0 rounded-xl border border-border bg-card px-3 py-3">
                  <p
                    className={currentScore != null ? "font-mono-num text-3xl font-bold text-brand" : "py-1 text-sm font-semibold text-muted-foreground"}
                    data-testid="my-id-overall"
                  >
                    {currentScore ?? "Not scored yet"}
                  </p>
                  <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Overall score</p>
                </div>
              </div>
              {currentScore == null && (
                <p className="text-xs text-muted-foreground">Scores appear after your first scored evaluation.</p>
              )}
              <div className="border-t border-divider pt-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 shrink-0 text-brand" />
                  <PanelLabel>Skill radar</PanelLabel>
                </div>
                {radarData.length >= 3 ? (
                  <IdRadarChart data={radarData} />
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Your radar fills in after coaches submit evaluations.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {milestones.length > 0 && (
            <Card className="rounded-2xl border-border bg-card" data-testid="my-id-milestones">
              <CardContent className="space-y-2 pt-4 pb-4">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 shrink-0 text-brand" />
                  <PanelLabel>Milestones</PanelLabel>
                </div>
                {milestones.slice(0, 8).map((ms) => (
                  <div key={ms.id} className="border-b border-divider pb-2 text-sm last:border-0 last:pb-0">
                    <p className="font-semibold text-foreground">{ms.label}</p>
                    {ms.detail && <p className="text-xs text-muted-foreground">{ms.detail}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {media.length > 0 && (
            <Card className="rounded-2xl border-border bg-card" data-testid="my-id-media">
              <CardContent className="space-y-2 pt-4 pb-4">
                <div className="flex items-center gap-2">
                  <Film className="h-4 w-4 shrink-0 text-brand" />
                  <PanelLabel>Photos and video</PanelLabel>
                </div>
                <p className="text-xs text-muted-foreground">Only the clips you have approved are shared with coaches.</p>
                {media.slice(0, 8).map((m, i) => (
                  <div key={m.id || i} className="flex items-center gap-3 border-b border-divider pb-2 last:border-0 last:pb-0">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
                      <Film className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {m.description || m.file_name || m.title || "Upload"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.media_type || m.file_type || m.content_type || "Media"}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card className="rounded-2xl border-border bg-card" data-testid="my-id-timeline">
            <CardContent className="space-y-2 pt-4 pb-4">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 shrink-0 text-brand" />
                <PanelLabel>Camps and evaluations</PanelLabel>
              </div>
              {evals.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nothing here yet — this fills in after {firstName}&apos;s first camp.
                </p>
              ) : (
                <div className="space-y-2">
                  {evals.map((ev) => (
                    <div key={ev.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-border bg-card px-4 py-3">
                      <div className="min-w-0 flex-1 basis-[160px]">
                        <p className="break-words text-sm font-semibold text-foreground">{ev.event_name || "Event"}</p>
                        <p className="break-words text-xs text-muted-foreground">
                          {[ev.station_name, ev.event_date].filter(Boolean).join(" · ") || "Date to be confirmed"}
                        </p>
                      </div>
                      {ev.computed?.overall_score != null ? (
                        <p className="font-mono-num text-lg font-bold text-brand">{ev.computed.overall_score}</p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Not scored yet</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Long-form detail stays collapsed (§23) */}
          {hasDetails && (
            <Card className="rounded-2xl border-border bg-card">
              <CardContent className="py-0">
                <Accordion type="single" collapsible>
                  <AccordionItem value="details" className="border-b-0">
                    <AccordionTrigger data-testid="my-id-details-toggle">More detail</AccordionTrigger>
                    <AccordionContent className="space-y-4">
                      {athlete.bio && (
                        <div>
                          <PanelLabel>About</PanelLabel>
                          <p className="mt-1 text-sm text-muted-foreground">{athlete.bio}</p>
                        </div>
                      )}
                      {ranked.length > 0 && (
                        <div className="space-y-1">
                          <PanelLabel>All category scores</PanelLabel>
                          {ranked.map(([name, d]) => (
                            <div key={name} className="flex justify-between gap-2 border-b border-divider pb-1 text-sm last:border-0">
                              <span className="min-w-0">{name}</span>
                              <span className="font-mono-num font-semibold">{d.score}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {metrics.length > 0 && (
                        <div className="space-y-1">
                          <PanelLabel>Every reading</PanelLabel>
                          {metrics.slice(0, 20).map((m, i) => (
                            <div key={m.id || `${m.metric_key}-${i}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-divider pb-1 text-sm last:border-0">
                              <span className="min-w-0 capitalize text-muted-foreground">{metricLabel(m)}</span>
                              <span className="flex items-center gap-2">
                                <VerificationBadge source={metricSource(m)} iconOnly />
                                <span className="font-mono-num font-semibold">{m.value}{m.unit ? ` ${m.unit}` : ""}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {awards.length > 0 && (
                        <div className="space-y-1">
                          <PanelLabel>Awards</PanelLabel>
                          {awards.map((a) => (
                            <div key={a.id} className="flex justify-between gap-2 text-sm">
                              <span className="min-w-0">{a.title}</span>
                              <span className="text-xs capitalize text-muted-foreground">{a.status}</span>
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
        </div>

        {/* ----------------------- RIGHT RAIL -------------------------- */}
        <div className="min-w-0 space-y-4">
          {/* ID card — the hero owns identity, so this keeps only the permanent
              ID, the QR and the sharing controls. */}
          <Card className="overflow-hidden rounded-2xl border-border bg-card" data-testid="id-card">
            <CardContent className="space-y-3 pt-4 pb-4">
              <PanelLabel>60&apos;6&quot; ID card</PanelLabel>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1 basis-[130px]">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Permanent ID</p>
                  <p className="break-all font-mono-num text-lg font-bold text-brand" data-testid="id-card-permanent-id">{permanentId}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    This number stays with {firstName} for good — coaches use it to find the record.
                  </p>
                </div>
                {qrUrl && (
                  <div className="shrink-0 text-center">
                    <img src={qrUrl} alt="ID QR" className="mx-auto h-28 w-28 max-w-full rounded-xl border border-border bg-white p-1" data-testid="id-card-qr" />
                    <p className="mt-1 max-w-[8rem] text-[10px] text-muted-foreground">Scan to open the ID Story</p>
                  </div>
                )}
              </div>
              {card?.headline_overall != null ? (
                <div className="border-t border-divider pt-3">
                  <p className="font-mono-num text-3xl font-bold text-brand">{card.headline_overall}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Headline overall</p>
                </div>
              ) : (
                <p className="border-t border-divider pt-3 text-xs text-muted-foreground">
                  Scores appear after your first scored evaluation.
                </p>
              )}
              {(card?.highlight_metrics || []).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {card.highlight_metrics.map((h) => (
                    <span key={h.key} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 font-mono-num text-xs">
                      <span className="truncate">{h.label}: {h.value}{h.unit ? ` ${h.unit}` : ""}</span>
                      <VerificationBadge source={sourceByKey[h.key]} iconOnly />
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Share2 className="h-4 w-4 shrink-0 text-brand" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Public ID Story</p>
                    <p className="text-xs text-muted-foreground">Share a link with family and coaches.</p>
                  </div>
                </div>
                <Switch checked={!!card?.public_enabled} onCheckedChange={togglePublic} data-testid="public-story-toggle" />
                {card?.story_url && (
                  <a href={card.story_url} target="_blank" rel="noreferrer" className="w-full min-w-0 truncate text-xs text-info hover:underline" data-testid="story-link">
                    {card.story_url}
                  </a>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Profile completion — same five checks staff sees, read as a checklist. */}
          <Card className="rounded-2xl border-border bg-card" data-testid="my-id-completion">
            <CardContent className="space-y-3 pt-4 pb-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <PanelLabel>Profile completion</PanelLabel>
                <p className="font-mono-num text-2xl font-bold text-brand">{completion.pct}%</p>
              </div>
              <Progress value={completion.pct} className="h-3" />
              <p className="text-xs text-muted-foreground">
                {completion.missing.length === 0
                  ? "Everything coaches look for is on file."
                  : `A few things would round out ${firstName}'s profile:`}
              </p>
              <ul className="space-y-1.5">
                {completion.checks.map((c) => (
                  <li key={c.key} className="flex items-center gap-2 text-xs">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.ok ? "bg-success" : "bg-warning"}`} />
                    <span className={c.ok ? "text-muted-foreground" : "font-semibold text-foreground"}>{c.label}</span>
                  </li>
                ))}
              </ul>
              {completion.missing.length > 0 && (
                <Button asChild variant="outline" className="w-full rounded-xl border-brand text-brand">
                  <Link to={selectedId ? `/my-id/edit?athlete_id=${selectedId}` : "/my-id/edit"}>Add the missing bits</Link>
                </Button>
              )}
            </CardContent>
          </Card>

          {/* What's next — only rendered when a real upcoming date exists in the payload */}
          {(nextEvalDate || nextGoalDate) && (
            <Card className="rounded-2xl border-border bg-card" data-testid="my-dev-whats-next">
              <CardContent className="space-y-2 pt-4 pb-4">
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 shrink-0 text-brand" />
                  <PanelLabel>What&apos;s next</PanelLabel>
                </div>
                {nextEvalDate && (
                  <p className="text-sm text-muted-foreground">
                    Your next camp: <span className="font-mono-num font-semibold text-foreground">{nextEvalDate}</span>
                  </p>
                )}
                {!nextEvalDate && nextGoalDate && (
                  <p className="text-sm text-muted-foreground">
                    Next goal check-in: <span className="font-mono-num font-semibold text-foreground">{nextGoalDate}</span>
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Already in a real org — quieter path to switch/join another club. */}
          {!inRegistry && <JoinClubCard prominent={false} />}
        </div>
      </div>
    </div>
  );
}
