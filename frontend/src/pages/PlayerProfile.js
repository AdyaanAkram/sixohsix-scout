import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { api, errMsg, signedUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { StatusBadge, VerificationBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { TimelineItem } from "@/components/common/TimelineItem";
import { IdRadarChart } from "@/components/common/IdRadarChart";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  ArrowLeft, FileDown, Flag, Plus, TrendingUp, TrendingDown, Minus,
  ClipboardList, Image as ImageIcon, StickyNote, CalendarClock, Target, Archive, Camera, Mail,
  Gauge, Trophy, Sparkles, ChevronDown, Check, X,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

function formatPermanentId(id) {
  return `606-${String(id || "").slice(0, 8).toUpperCase()}`;
}

const RECENT_EVAL_MONTHS = 12;

function latestEvaluationDate(summary) {
  const dates = (summary?.event_scores || [])
    .map((e) => e.event_date)
    .concat([summary?.last_evaluation_date])
    .filter(Boolean)
    .map((d) => new Date(d))
    .filter((d) => !Number.isNaN(d.getTime()));
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map((d) => d.getTime())));
}

function hasRecentEvaluation(summary) {
  if ((summary?.evaluation_count || 0) === 0) return false;
  const latest = latestEvaluationDate(summary);
  if (!latest) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RECENT_EVAL_MONTHS);
  return latest >= cutoff;
}

// Media rows are keyed on file_type ("photo" | "video"), which is what the rest
// of this page renders off. Consent must be approved — never count a video that
// is still pending guardian consent.
function hasApprovedVideo(mediaList) {
  return (mediaList || []).some(
    (m) => m.file_type === "video" && (m.consent_status === "approved" || m.status === "approved")
  );
}

function computeProfileCompletion(athlete, summary, mediaList) {
  const checks = [
    { key: "photo", label: "Updated photo", ok: Boolean(athlete?.photo_url) },
    { key: "height", label: "Current height", ok: Boolean(athlete?.height) },
    { key: "weight", label: "Current weight", ok: Boolean(athlete?.weight) },
    { key: "eval", label: `Evaluation in last ${RECENT_EVAL_MONTHS} months`, ok: hasRecentEvaluation(summary) },
    { key: "video", label: "Approved video", ok: hasApprovedVideo(mediaList) },
  ];
  const done = checks.filter((c) => c.ok).length;
  return { pct: Math.round((done / checks.length) * 100), missing: checks.filter((c) => !c.ok).map((c) => c.label), checks };
}

const METRIC_SOURCES = [
  { value: "athlete_submitted", label: "Athlete submitted" },
  { value: "parent_submitted", label: "Parent submitted" },
  { value: "coach_submitted", label: "Coach submitted" },
  { value: "event_verified", label: "Event verified" },
  { value: "device_verified", label: "Device verified" },
  { value: "id_verified", label: "60'6\" ID verified" },
];

const SourceBadge = ({ source, compact }) =>
  source ? <VerificationBadge source={source} compact={compact} /> : null;

// The API returns measurement points as objects; tolerate a bare number too.
function pointValue(p) {
  if (typeof p === "number") return Number.isFinite(p) ? p : null;
  return typeof p?.value === "number" && Number.isFinite(p.value) ? p.value : null;
}

// Benchmarks are two-point (floor → elite). Chart the elite target and label it
// as such — never invent a single "benchmark value" when none is defined.
function benchmarkPoint(b) {
  if (typeof b === "number") return Number.isFinite(b) ? { value: b, elite: false } : null;
  if (!b) return null;
  if (typeof b.elite_value === "number") return { value: b.elite_value, elite: true, floor: b.floor_value };
  if (typeof b.value === "number") return { value: b.value, elite: false };
  return null;
}

// Only comparators the API actually returned are charted — a missing benchmark
// is omitted entirely, never estimated.
function comparisonSeries(item) {
  const age = benchmarkPoint(item?.age_group_benchmark ?? item?.age_benchmark);
  const pos = benchmarkPoint(item?.position_benchmark);
  return [
    { key: "current", name: "Current", value: pointValue(item?.current) },
    { key: "previous", name: "Previous", value: pointValue(item?.previous) },
    { key: "personal_best", name: "Personal best", value: pointValue(item?.personal_best) },
    { key: "age_benchmark", name: age?.elite ? "Age group elite" : "Age group", value: age?.value ?? null },
    { key: "position_benchmark", name: pos?.elite ? "Position elite" : "Position", value: pos?.value ?? null },
  ].filter((s) => typeof s.value === "number" && Number.isFinite(s.value));
}

// Exit velocity and the 60-yard dash headline the hero KPI row. Keys are
// canonical (spec §4D) but legacy spellings are tolerated for older rows.
const EXIT_VELO_KEYS = ["exit_velocity", "exit_velo"];
const SIXTY_YARD_KEYS = ["sixty_yard_dash", "sixty_yd", "sixty_yard", "60_yd", "60yd", "60_yard_dash"];

// Headline value for a KPI card: personal best when on file, otherwise the
// latest measurement — never a fabricated number. Returns null when the
// athlete has no such metric, so the card is omitted entirely.
function headlineMetric(comparison, keys) {
  const item = (comparison || []).find((c) => keys.includes(c.metric_key));
  if (!item) return null;
  const bestVal = pointValue(item.personal_best);
  const curVal = pointValue(item.current);
  const usingBest = typeof bestVal === "number";
  const value = usingBest ? bestVal : curVal;
  if (typeof value !== "number") return null;
  const point = usingBest ? item.personal_best : item.current;
  const source =
    (point && typeof point === "object" && point.source) ||
    (item.current && typeof item.current === "object" && item.current.source) ||
    null;
  return { value, unit: item.unit || "", source, isBest: usingBest };
}

function deltaLabel(current, other, lowerBetter, unit) {
  if (typeof current !== "number" || typeof other !== "number") return null;
  const diff = Math.round((current - other) * 100) / 100;
  if (diff === 0) return { text: "even", tone: "text-muted-foreground" };
  const text = `${diff > 0 ? "+" : ""}${diff}${unit ? ` ${unit}` : ""}`;
  // Direction unknown (legacy metric with no catalog entry) — stay neutral
  // rather than implying a higher number is better.
  if (typeof lowerBetter !== "boolean") return { text, tone: "text-muted-foreground" };
  const better = lowerBetter ? diff < 0 : diff > 0;
  return { text, tone: better ? "text-success" : "text-destructive" };
}

const MetricRow = ({ m }) => (
  <Card className="rounded-2xl border-border">
    <CardContent className="py-3 flex justify-between gap-2">
      <div>
        <p className="text-sm font-semibold capitalize">{m.label || String(m.metric_key || "").replace(/_/g, " ")}</p>
        <p className="text-xs text-muted-foreground">{m.measured_at} · {m.verified_by_name || "Staff"}</p>
        {m.source && <div className="mt-1"><SourceBadge source={m.source} compact /></div>}
      </div>
      <p className="font-mono-num font-bold text-lg text-brand">{m.value} {m.unit}</p>
    </CardContent>
  </Card>
);

const MetricComparisonCard = ({ item }) => {
  const series = comparisonSeries(item);
  const current = pointValue(item?.current);
  const comparators = series.filter((s) => s.key !== "current");
  const unit = item?.unit || "";
  const lower = item?.lower_better;
  return (
    <Card className="rounded-2xl border-border" data-testid={`metric-comparison-${item.metric_key}`}>
      <CardContent className="py-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{item.label || String(item.metric_key || "").replace(/_/g, " ")}</p>
            <p className="text-xs text-muted-foreground">
              {item?.current?.measured_at || "—"}
              {lower === true && <span className="ml-2 text-[10px] uppercase tracking-wide">Lower is better</span>}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono-num font-bold text-2xl text-brand">{typeof current === "number" ? current : "—"} {unit}</p>
            {item?.current?.source && <div className="mt-1 flex justify-end"><SourceBadge source={item.current.source} /></div>}
          </div>
        </div>

        {comparators.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={40 + series.length * 26}>
              <BarChart data={series} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 10 }}>
                <CartesianGrid stroke="hsl(var(--divider))" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={92} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => `${v} ${unit}`} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={14}>
                  {series.map((s) => (
                    <Cell key={s.key} fill={s.key === "current" ? "hsl(var(--brand))" : "hsl(var(--surface-3))"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-2">
              {comparators.map((c) => {
                const d = deltaLabel(current, c.value, lower, unit);
                if (!d) return null;
                return (
                  <span key={c.key} className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px]">
                    <span className="text-muted-foreground">vs {c.name.toLowerCase()} </span>
                    <span className={`font-mono-num font-semibold ${d.tone}`}>{d.text}</span>
                  </span>
                );
              })}
              {typeof item?.percentile === "number" && (
                <span className="rounded-full bg-brand/15 border border-brand/40 text-brand px-2.5 py-0.5 text-[11px] font-semibold font-mono-num">
                  {Math.round(item.percentile)}th percentile
                </span>
              )}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No previous result, personal best or benchmark on file to compare against yet.</p>
        )}
      </CardContent>
    </Card>
  );
};

const ASSESSMENT_TYPES = ["Practice Observation", "Game Observation", "Training Assessment", "Tryout Assessment", "Showcase Assessment", "Development Check-In", "Injury Return Observation", "Position Review", "Scout Follow-Up"];
const NOTE_TYPES = [
  { value: "general", label: "General" },
  { value: "development", label: "Development" },
  { value: "private_staff", label: "Private staff" },
  { value: "parent_visible", label: "Parent visible" },
  { value: "scout", label: "Scout" },
  { value: "follow_up", label: "Follow-up" },
];
const GOAL_STATUSES = ["Not Started", "Active", "Improving", "Needs Attention", "Completed", "Archived"];

function noteTypeLabel(n) {
  const t = n.note_type || n.visibility || "";
  if (t === "scout_assessment" || t === "scout") return "Head Scout Assessment";
  const hit = NOTE_TYPES.find((x) => x.value === t);
  if (hit) return hit.label;
  return n.assessment_type || "Note";
}

const AddAssessmentDialog = ({ athleteId, onDone }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    assessment_type: "Practice Observation",
    note_type: "development",
    strengths: "",
    development_priorities: "",
    recommended_drills: "",
    position_recommendation: "",
    follow_up_date: "",
    team_or_program: "",
    parent_visible_note: "",
    internal_note: "",
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/athletes/${athleteId}/notes`, { ...form, athlete_id: athleteId, visibility: form.note_type });
      toast.success("Note added (append-only).");
      setOpen(false);
      onDone();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="rounded-xl bg-primary hover:bg-brand-secondary h-10" data-testid="add-assessment-button"><Plus className="h-4 w-4 mr-1" /> Add Assessment</Button>
      </DialogTrigger>
      <DialogContent className="rounded-2xl max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-2xl text-foreground">Staff Note</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Note type / visibility</Label>
              <Select value={form.note_type} onValueChange={set("note_type")}>
                <SelectTrigger className="h-10 rounded-lg" data-testid="note-type-select"><SelectValue /></SelectTrigger>
                <SelectContent>{NOTE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Assessment type</Label>
              <Select value={form.assessment_type} onValueChange={set("assessment_type")}>
                <SelectTrigger className="h-10 rounded-lg" data-testid="assessment-type-select"><SelectValue /></SelectTrigger>
                <SelectContent>{ASSESSMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Team or program</Label><Input value={form.team_or_program} onChange={set("team_or_program")} className="h-10 rounded-lg" /></div>
          <div className="space-y-1"><Label className="text-xs">Strengths</Label><Textarea value={form.strengths} onChange={set("strengths")} rows={2} className="rounded-lg" data-testid="assessment-strengths" /></div>
          <div className="space-y-1"><Label className="text-xs">Development priorities</Label><Textarea value={form.development_priorities} onChange={set("development_priorities")} rows={2} className="rounded-lg" /></div>
          <div className="space-y-1"><Label className="text-xs">Recommended drills</Label><Textarea value={form.recommended_drills} onChange={set("recommended_drills")} rows={2} className="rounded-lg" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Position recommendation</Label><Input value={form.position_recommendation} onChange={set("position_recommendation")} className="h-10 rounded-lg" /></div>
            <div className="space-y-1"><Label className="text-xs">Follow-up date</Label><Input type="date" value={form.follow_up_date} onChange={set("follow_up_date")} className="h-10 rounded-lg" /></div>
          </div>
          {form.note_type === "parent_visible" && (
            <div className="space-y-1"><Label className="text-xs">Parent-visible note</Label><Textarea value={form.parent_visible_note} onChange={set("parent_visible_note")} rows={2} className="rounded-lg" data-testid="parent-visible-note" /></div>
          )}
          {form.note_type === "private_staff" && (
            <div className="space-y-1"><Label className="text-xs">Internal staff note</Label><Textarea value={form.internal_note} onChange={set("internal_note")} rows={2} className="rounded-lg" /></div>
          )}
        </div>
        <DialogFooter><Button className="w-full rounded-xl bg-primary h-11" disabled={busy} onClick={submit} data-testid="assessment-submit-button">{busy ? "Saving…" : "Save Note"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const AddGoalDialog = ({ athleteId, onDone }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", category: "", starting_point: "", target: "", target_date: "", recommended_drills: "", status: "Active", progress: 0 });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const submit = async () => {
    setBusy(true);
    try {
      await api.post("/goals", { ...form, athlete_id: athleteId, progress: parseInt(form.progress) || 0 });
      toast.success("Development goal created.");
      setOpen(false);
      onDone();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="rounded-xl h-10" data-testid="add-goal-button"><Target className="h-4 w-4 mr-1" /> New Goal</Button>
      </DialogTrigger>
      <DialogContent className="rounded-2xl max-w-md">
        <DialogHeader><DialogTitle className="font-display text-2xl text-foreground">Development Goal</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label className="text-xs">Goal title *</Label><Input value={form.title} onChange={set("title")} className="h-10 rounded-lg" data-testid="goal-title-input" placeholder="e.g. Raise exit velocity by 5 mph" /></div>
          <div className="space-y-1"><Label className="text-xs">Description</Label><Textarea value={form.description} onChange={set("description")} rows={2} className="rounded-lg" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Category</Label><Input value={form.category} onChange={set("category")} className="h-10 rounded-lg" placeholder="Hitting" /></div>
            <div className="space-y-1"><Label className="text-xs">Target date</Label><Input type="date" value={form.target_date} onChange={set("target_date")} className="h-10 rounded-lg" /></div>
            <div className="space-y-1"><Label className="text-xs">Starting point</Label><Input value={form.starting_point} onChange={set("starting_point")} className="h-10 rounded-lg" /></div>
            <div className="space-y-1"><Label className="text-xs">Target</Label><Input value={form.target} onChange={set("target")} className="h-10 rounded-lg" /></div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Recommended drills</Label><Textarea value={form.recommended_drills} onChange={set("recommended_drills")} rows={2} className="rounded-lg" /></div>
        </div>
        <DialogFooter><Button className="w-full rounded-xl bg-primary h-11" disabled={busy || !form.title} onClick={submit} data-testid="goal-submit-button">{busy ? "Saving…" : "Create Goal"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ScoutAssessmentDialog = ({ athleteId, onDone }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ summary: "", position_recommendation: "", development_recommendation: "", flag_follow_up: false, team_consideration: false, confidential: false });
  const submit = async () => {
    setBusy(true);
    try {
      await api.post("/scout-assessments", { ...form, athlete_id: athleteId });
      toast.success("Scout assessment saved.");
      setOpen(false);
      onDone();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="rounded-xl h-10" data-testid="add-scout-assessment-button"><Flag className="h-4 w-4 mr-1" /> Scout Assessment</Button>
      </DialogTrigger>
      <DialogContent className="rounded-2xl max-w-md">
        <DialogHeader><DialogTitle className="font-display text-2xl text-foreground">Head Scout Assessment</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label className="text-xs">Final scouting summary *</Label><Textarea value={form.summary} onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))} rows={3} className="rounded-lg" data-testid="scout-summary-textarea" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Position projection</Label><Input value={form.position_recommendation} onChange={(e) => setForm((f) => ({ ...f, position_recommendation: e.target.value }))} className="h-10 rounded-lg" /></div>
          </div>
          <div className="space-y-1"><Label className="text-xs">Development recommendation</Label><Textarea value={form.development_recommendation} onChange={(e) => setForm((f) => ({ ...f, development_recommendation: e.target.value }))} rows={2} className="rounded-lg" /></div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.flag_follow_up} onCheckedChange={(v) => setForm((f) => ({ ...f, flag_follow_up: v }))} data-testid="scout-flag-checkbox" /> Flag for follow-up</label>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.team_consideration} onCheckedChange={(v) => setForm((f) => ({ ...f, team_consideration: v }))} /> Mark for team consideration</label>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.confidential} onCheckedChange={(v) => setForm((f) => ({ ...f, confidential: v }))} /> Confidential (scouts &amp; admins only)</label>
        </div>
        <DialogFooter><Button className="w-full rounded-xl bg-primary h-11" disabled={busy || !form.summary} onClick={submit} data-testid="scout-assessment-submit">{busy ? "Saving…" : "Save Assessment"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const UploadPhotoDialog = ({ athleteId, onDone }) => {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [desc, setDesc] = useState("");
  const [consent, setConsent] = useState(false);
  const [isProfile, setIsProfile] = useState(false);
  const [busy, setBusy] = useState(false);
  const upload = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("athlete_id", athleteId);
      fd.append("description", desc);
      fd.append("consent_verified", "true");
      fd.append("is_profile_photo", isProfile ? "true" : "false");
      await api.post("/media/upload", fd);
      toast.success("Media uploaded.");
      setOpen(false); setFile(null); setDesc(""); setConsent(false);
      onDone();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="rounded-xl h-10" data-testid="upload-media-button"><Camera className="h-4 w-4 mr-1" /> Upload Media</Button>
      </DialogTrigger>
      <DialogContent className="rounded-2xl max-w-sm">
        <DialogHeader><DialogTitle className="font-display text-2xl text-foreground">Upload Media</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input type="file" accept="image/*,video/*" onChange={(e) => setFile(e.target.files?.[0] || null)} className="rounded-xl h-11 pt-2" data-testid="profile-media-file-input" />
          <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder="Description" className="rounded-xl" />
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={isProfile} onCheckedChange={setIsProfile} /> Set as profile photo</label>
          <label className="flex items-start gap-2 text-xs text-muted-foreground"><Checkbox checked={consent} onCheckedChange={setConsent} className="mt-0.5" data-testid="profile-media-consent" /> I confirm media consent has been verified for this athlete.</label>
        </div>
        <DialogFooter><Button className="w-full rounded-xl bg-primary h-11" disabled={!file || !consent || busy} onClick={upload} data-testid="profile-media-upload-submit">{busy ? "Uploading…" : "Upload"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default function PlayerProfile() {
  const { athleteId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "overview";
  const [summary, setSummary] = useState(null);
  const [evaluations, setEvaluations] = useState(null);
  const [notes, setNotes] = useState(null);
  const [goals, setGoals] = useState(null);
  const [media, setMedia] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [inviteStatus, setInviteStatus] = useState(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const [milestones, setMilestones] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [sources, setSources] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [metricForm, setMetricForm] = useState({ metric_key: "exit_velo", value: "", measured_at: "", source: "coach_submitted" });
  const [metricBusy, setMetricBusy] = useState(false);
  const [metricError, setMetricError] = useState("");
  const [awards, setAwards] = useState(null);
  const [awardForm, setAwardForm] = useState({ title: "", category: "overall", description: "" });
  const [awardBusy, setAwardBusy] = useState(false);
  const [plan, setPlan] = useState(null);
  const [planBusy, setPlanBusy] = useState(false);

  const role = user?.role;
  const isAdmin = ["owner", "admin"].includes(role);
  const canCoach = ["owner", "admin", "head_scout", "coach"].includes(role);
  const canReview = ["owner", "admin", "head_scout"].includes(role);

  const loadSummary = useCallback(() => {
    api.get(`/athletes/${athleteId}/summary`).then((r) => setSummary(r.data)).catch((e) => { toast.error(errMsg(e)); navigate("/players"); });
  }, [athleteId, navigate]);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  // Media must load on mount, not only when the Media tab opens: profile
  // completion counts an approved video and otherwise caps at 80% for everyone.
  const loadMedia = useCallback(() => {
    api.get(`/athletes/${athleteId}/media`).then((r) => setMedia(r.data)).catch(() => setMedia([]));
  }, [athleteId]);
  useEffect(() => { loadMedia(); }, [loadMedia]);

  // Headline verified metrics (exit velocity, 60-yard) surface in the hero KPI
  // row, so the comparison endpoint must load on mount — not only when the
  // Verified Metrics tab opens.
  const loadComparison = useCallback(() => {
    api.get(`/metrics/athlete/${athleteId}/comparison`)
      .then((r) => setComparison(Array.isArray(r.data) ? r.data : (r.data?.metrics || [])))
      .catch(() => setComparison([]));
  }, [athleteId]);
  useEffect(() => { loadComparison(); }, [loadComparison]);

  useEffect(() => {
    if (!canCoach) return;
    api.get(`/athletes/${athleteId}/invite-status`)
      .then((r) => setInviteStatus(r.data))
      .catch(() => setInviteStatus({ status: "not_sent" }));
  }, [athleteId, canCoach]);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", guardian_name: "", guardian_email: "" });

  const openInvite = () => {
    const a = summary?.athlete || {};
    setInviteForm({ email: a.email || "", guardian_name: a.guardian_name || "", guardian_email: a.guardian_email || "" });
    setInviteOpen(true);
  };

  // PATCH /athletes replaces the whole document, so contact edits must ride on
  // a full merged payload — a partial body would null every other field.
  const ATHLETE_PATCH_KEYS = [
    "first_name", "last_name", "preferred_name", "date_of_birth", "age_group", "graduation_year",
    "primary_position", "secondary_positions", "bats", "throws", "height", "weight", "jersey_number",
    "current_team", "school", "city", "state", "country", "guardian_name", "guardian_email",
    "guardian_phone", "emergency_contact", "email", "status", "photo_url",
  ];

  const sendInvite = async () => {
    const a = summary?.athlete || {};
    setInviteBusy(true);
    try {
      const contactChanged = ["email", "guardian_name", "guardian_email"]
        .some((k) => (inviteForm[k] || "").trim() !== (a[k] || ""));
      if (contactChanged) {
        const payload = {};
        ATHLETE_PATCH_KEYS.forEach((k) => { payload[k] = a[k] ?? null; });
        payload.secondary_positions = a.secondary_positions || [];
        payload.status = a.status || "active";
        payload.email = inviteForm.email.trim() || null;
        payload.guardian_name = inviteForm.guardian_name.trim() || null;
        payload.guardian_email = inviteForm.guardian_email.trim() || null;
        await api.patch(`/athletes/${athleteId}`, payload);
        loadSummary();
      }
      const r = await api.post(`/athletes/${athleteId}/invite`);
      setInviteStatus({ status: "pending", email: r.data.email, expires_at: r.data.expires_at });
      toast.success(`Invitation sent to ${r.data.email}`);
      setInviteOpen(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setInviteBusy(false);
    }
  };

  useEffect(() => {
    if (tab === "evaluations" && !evaluations) {
      api.get("/review/queue").then((r) => setEvaluations(r.data.filter((e) => e.athlete_id === athleteId))).catch(() => {
        api.get("/my-evaluations").then((r) => setEvaluations(r.data.filter((e) => e.athlete_id === athleteId))).catch(() => setEvaluations([]));
      });
    }
    if (tab === "notes" && !notes) api.get(`/athletes/${athleteId}/notes`).then((r) => setNotes(r.data)).catch(() => setNotes([]));
    if (tab === "development" && !goals) {
      api.get(`/athletes/${athleteId}/goals`).then((r) => setGoals(r.data)).catch(() => setGoals([]));
      api.get(`/athletes/${athleteId}/development-plan/latest`).then((r) => setPlan(r.data)).catch(() => setPlan(false));
    }
    if (tab === "story" && !timeline) {
      // Unified staff timeline — same item shape as the public ID Story. Media
      // bytes are served by an authenticated route, so resolve the signed
      // thumbnail URL here from the media_id the API returns.
      api.get(`/athletes/${athleteId}/story-timeline`)
        .then((r) => setTimeline((r.data || []).map((e) => (
          e.media_id && e.subtitle === "photo"
            ? { ...e, thumbnail_url: signedUrl(`/media/${e.media_id}/file`) }
            : e
        ))))
        .catch(() => setTimeline([]));
    }
    if (tab === "verified" && !metrics) {
      api.get(`/metrics/athlete/${athleteId}`).then((r) => setMetrics(r.data)).catch(() => setMetrics([]));
      api.get(`/milestones/athlete/${athleteId}`).then((r) => setMilestones(r.data)).catch(() => setMilestones([]));
      // Per-metric comparison (previous / personal best / age + position benchmark).
      // Degrades to the plain measurement list while the endpoint is unavailable.
      api.get(`/metrics/athlete/${athleteId}/comparison`)
        .then((r) => setComparison(Array.isArray(r.data) ? r.data : (r.data?.metrics || [])))
        .catch(() => setComparison([]));
    }
    if (tab === "awards" && !awards) {
      api.get(`/awards/athlete/${athleteId}`).then((r) => setAwards(r.data)).catch(() => setAwards([]));
    }
  }, [tab, athleteId, evaluations, notes, goals, timeline, metrics, awards]);

  // Catalog carries each metric's unit and lower_better direction, which the
  // career-best aggregation needs regardless of which tab is open.
  useEffect(() => {
    api.get("/metrics/catalog").then((r) => {
      const list = r.data || [];
      setCatalog(list);
      setMetricForm((f) => (list.some((c) => c.key === f.metric_key)
        ? f
        : { ...f, metric_key: (list.find((c) => !c.legacy) || {}).key || f.metric_key }));
    }).catch(() => {});
  }, []);

  // Only offer sources this role may actually write — the API rejects the rest.
  useEffect(() => {
    api.get("/metrics/sources").then((r) => {
      setSources((r.data?.sources || []).filter((s) => s.allowed_for_me !== false));
      if (r.data?.default_for_me) setMetricForm((f) => ({ ...f, source: r.data.default_for_me }));
    }).catch(() => {});
  }, []);

  const refreshAll = () => {
    loadSummary();
    loadMedia();
    loadComparison();
    setNotes(null); setGoals(null); setTimeline(null);
    setMetrics(null); setMilestones(null); setAwards(null); setPlan(null);
  };

  const logMetric = async () => {
    if (!metricForm.value) return;
    setMetricBusy(true);
    setMetricError("");
    try {
      const r = await api.post("/metrics", {
        athlete_id: athleteId,
        metric_key: metricForm.metric_key,
        value: parseFloat(metricForm.value),
        measured_at: metricForm.measured_at || undefined,
        source: metricForm.source || undefined,
      });
      toast.success(r.data.is_personal_best ? "Logged — new personal best!" : "Metric logged.");
      setMetricForm((f) => ({ ...f, value: "" }));
      setMetrics(null); setMilestones(null); loadComparison();
    } catch (e) {
      // The API rejects verified-tier sources for unauthorized roles — show the
      // reason inline instead of leaving the form looking successful.
      const msg = errMsg(e);
      setMetricError(msg);
      toast.error(msg);
    } finally { setMetricBusy(false); }
  };

  const submitAward = async () => {
    if (!awardForm.title.trim()) return;
    setAwardBusy(true);
    try {
      await api.post("/awards", { ...awardForm, athlete_id: athleteId });
      toast.success("Award submitted for review.");
      setAwardForm({ title: "", category: "overall", description: "" });
      setAwards(null);
    } catch (e) { toast.error(errMsg(e)); } finally { setAwardBusy(false); }
  };

  const decideAward = async (id, approve) => {
    try {
      if (approve) await api.post(`/awards/${id}/approve`);
      else await api.post(`/awards/${id}/reject`, { reason: "Not verified" });
      toast.success(approve ? "Award approved." : "Award rejected.");
      setAwards(null); setMilestones(null);
    } catch (e) { toast.error(errMsg(e)); }
  };

  const generatePlan = async () => {
    setPlanBusy(true);
    try {
      const r = await api.post(`/athletes/${athleteId}/development-plan`);
      setPlan(r.data);
      toast.success("Development plan generated.");
    } catch (e) { toast.error(errMsg(e)); } finally { setPlanBusy(false); }
  };

  const resolveMediaConsent = async (mediaId, approve) => {
    try {
      await api.post(`/media/${mediaId}/consent`, { approve });
      toast.success(approve ? "Media approved." : "Media rejected.");
      loadMedia();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const updateGoal = async (goalId, patch) => {
    try {
      await api.patch(`/goals/${goalId}`, patch);
      api.get(`/athletes/${athleteId}/goals`).then((r) => setGoals(r.data));
      toast.success("Goal updated.");
    } catch (e) { toast.error(errMsg(e)); }
  };

  const archive = async () => {
    try {
      await api.post(`/athletes/${athleteId}/archive`);
      toast.success("Player archived.");
      loadSummary();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!summary) return <div className="space-y-3"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>;
  const a = summary.athlete;
  const cats = summary.category_scores || {};
  const radarData = Object.entries(cats).map(([name, d]) => ({ category: name, score: d.score }));
  // Strengths / needs come from the structured category scores only — never from
  // parsing the free-text assessment blobs.
  const rankedCats = Object.entries(cats)
    .filter(([, d]) => typeof d?.score === "number")
    .map(([name, d]) => ({ name, score: d.score }))
    .sort((x, y) => y.score - x.score);
  const sideCount = rankedCats.length > 1 ? Math.max(1, Math.min(3, Math.floor(rankedCats.length / 2))) : rankedCats.length;
  const topStrengths = rankedCats.slice(0, sideCount);
  const topNeeds = rankedCats.length > 1 ? rankedCats.slice(-sideCount).reverse() : [];
  const growthRows = summary.metric_history || [];
  const improvedCount = growthRows.filter((m) => m.improved === true).length;
  const declinedCount = growthRows.filter((m) => m.improved === false && m.change !== 0 && m.change != null).length;
  const trendData = (summary.event_scores || []).map((e) => ({ name: e.event_name?.slice(0, 14) || "Event", date: e.event_date, score: e.overall_score }));
  const change = summary.score_change;
  const completion = computeProfileCompletion(a, summary, media || []);
  const activeGoal = (goals || summary.goals || []).find((g) => g.status === "Active" || g.status === "Improving") || (goals || summary.goals || [])[0];
  const lastEvalDate = (summary.event_scores || [])[0]?.event_date || summary.last_evaluation_date || a.updated_at;
  const prevScore = summary.latest_overall != null && change != null ? Number(summary.latest_overall) - Number(change) : null;
  const compareBar = [
    { name: "Previous", score: prevScore ?? 0 },
    { name: "Current", score: summary.latest_overall ?? 0 },
  ];
  const metricCount = summary.verified_metric_count ?? (metrics || []).length;
  const orgName = user?.organization_name || a.organization_name || "";
  const isVerifiedId = summary.verified_metric_count > 0 || (metrics || []).length > 0;
  // Sketch format: 2029 | SS/3B | R/R — grad year, primary/secondary positions,
  // bats/throws. Segments with no data are omitted, never invented.
  const positionLine = [a.primary_position, ...(a.secondary_positions || [])].filter(Boolean).join("/");
  const identityLine = [
    a.graduation_year,
    positionLine,
    a.bats || a.throws ? `${a.bats || "—"}/${a.throws || "—"}` : null,
  ].filter(Boolean).join(" | ");
  const exitVeloKpi = headlineMetric(comparison, EXIT_VELO_KEYS);
  const sixtyKpi = headlineMetric(comparison, SIXTY_YARD_KEYS);
  const TAB_LABELS = {
    overview: "Overview", evaluations: "Evaluations", progress: "Progress", verified: "Verified Metrics",
    story: "Player Story", media: "Videos & Photos", notes: "Coach Notes", development: "Development Goals",
    events: "Events", seasons: "Seasons", rankings: "Rankings", private: "Private", awards: "Awards", timeline: "Timeline",
  };
  const PROFILE_TABS = ["overview", "evaluations", "progress", "verified", "story", "media", "notes", "development", "awards", "events", "seasons", "rankings", "private"];

  return (
    <div className="space-y-4">
      <button onClick={() => navigate("/players")} className="inline-flex items-center gap-1 text-sm text-info hover:underline" data-testid="profile-back-button">
        <ArrowLeft className="h-3.5 w-3.5" /> Players
      </button>

      {/* Hero — digital player card */}
      <Card className="rounded-2xl border-border overflow-hidden" data-testid="profile-hero">
        <div className="hero-sweep px-5 py-6 space-y-4">
          <div className="flex flex-col sm:flex-row gap-6">
            <PlayerAvatar firstName={a.first_name} lastName={a.last_name} size="hero" photoUrl={a.photo_url} className="mx-auto sm:mx-0" />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1.5 text-center sm:text-left mx-auto sm:mx-0">
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
                    <h1 className="font-display text-5xl sm:text-6xl leading-[0.95] text-foreground" data-testid="profile-player-name">{a.first_name} {a.last_name}</h1>
                    <StatusBadge status={a.status} />
                    {a.flagged_follow_up && <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 border border-destructive/40 text-destructive px-2.5 py-0.5 text-xs font-semibold"><Flag className="h-3 w-3" /> Follow-up</span>}
                  </div>
                  {identityLine && (
                    <p className="text-lg sm:text-xl font-semibold tracking-wide text-foreground" data-testid="profile-identity-line">{identityLine}</p>
                  )}
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-2 gap-y-1 text-sm text-muted-foreground">
                    {a.current_team && <span className="font-medium text-foreground">{a.current_team}</span>}
                    {a.current_team && orgName && <span aria-hidden="true">•</span>}
                    {orgName && <span>{orgName}</span>}
                    {isVerifiedId && (
                      <>
                        {(a.current_team || orgName) && <span aria-hidden="true">•</span>}
                        <span className="rounded-full bg-brand/20 border border-brand/40 text-brand px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">Verified 60&apos;6&quot; ID</span>
                      </>
                    )}
                  </div>
                  <p className="text-sm font-mono-num text-brand" data-testid="profile-permanent-id">{formatPermanentId(a.id)}</p>
                </div>
                <div className="flex flex-wrap justify-center sm:justify-end gap-2 mx-auto sm:mx-0">
                  {canCoach && (
                    <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                      <Button variant="outline" className="rounded-xl h-10" disabled={inviteBusy || inviteStatus?.status === "accepted"} onClick={openInvite} data-testid="invite-to-platform-button">
                        <Mail className="h-4 w-4 mr-1" />
                        {inviteStatus?.status === "accepted" ? "On platform" : inviteStatus?.status === "pending" ? "Resend invite" : "Invite to platform"}
                      </Button>
                      <DialogContent className="max-w-md rounded-2xl">
                        <DialogHeader>
                          <DialogTitle className="font-display text-2xl text-foreground">Invite to platform</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-3">
                          <p className="text-sm text-muted-foreground">
                            Under 13 (or no birth date on file): the invite goes to the <b>guardian</b>.
                            Ages 13–17: it goes to the <b>athlete&apos;s email</b> with the guardian copied. 18+: athlete only.
                          </p>
                          <div className="space-y-1">
                            <Label className="text-xs">Athlete email</Label>
                            <Input type="email" value={inviteForm.email} disabled={!isAdmin}
                              onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                              placeholder="athlete@example.com" className="h-10 rounded-lg" data-testid="invite-athlete-email-input" />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs">Guardian name</Label>
                              <Input value={inviteForm.guardian_name} disabled={!isAdmin}
                                onChange={(e) => setInviteForm((f) => ({ ...f, guardian_name: e.target.value }))}
                                className="h-10 rounded-lg" data-testid="invite-guardian-name-input" />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Guardian email</Label>
                              <Input type="email" value={inviteForm.guardian_email} disabled={!isAdmin}
                                onChange={(e) => setInviteForm((f) => ({ ...f, guardian_email: e.target.value }))}
                                placeholder="parent@example.com" className="h-10 rounded-lg" data-testid="invite-guardian-email-input" />
                            </div>
                          </div>
                          {!isAdmin && (
                            <p className="text-xs text-muted-foreground">Only an owner or admin can change these contact details — ask one to fill in a missing email.</p>
                          )}
                          {inviteStatus?.status === "pending" && (
                            <p className="text-xs text-muted-foreground">A previous invite to {inviteStatus.email} is still pending — sending again replaces it.</p>
                          )}
                        </div>
                        <DialogFooter>
                          <Button onClick={sendInvite} disabled={inviteBusy} className="rounded-xl bg-primary hover:bg-brand-secondary w-full h-11" data-testid="invite-send-button">
                            {inviteBusy ? "Sending…" : "Save & send invitation"}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  )}
                  {canReview && <Button variant="outline" className="rounded-xl h-10" onClick={() => window.open(signedUrl(`/reports/player/${athleteId}/pdf`), "_blank")} data-testid="profile-pdf-button"><FileDown className="h-4 w-4 mr-1" /> PDF</Button>}
                  {isAdmin && a.status === "active" && <Button variant="outline" className="rounded-xl h-10 text-muted-foreground" onClick={archive} data-testid="profile-archive-button"><Archive className="h-4 w-4 mr-1" /> Archive</Button>}
                </div>
              </div>
            </div>
          </div>
          {/* Full bio detail stays available — presentation changes, depth doesn't. */}
          <Collapsible>
            <CollapsibleTrigger className="inline-flex items-center gap-1 text-xs font-semibold text-info hover:underline [&[data-state=open]>svg]:rotate-180" data-testid="hero-details-expander">
              View Details <ChevronDown className="h-3.5 w-3.5" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2 text-sm">
                <div><p className="text-[10px] uppercase text-muted-foreground">Age group</p><p className="font-semibold">{a.age_group || "—"}</p></div>
                <div><p className="text-[10px] uppercase text-muted-foreground">Grad year</p><p className="font-semibold">{a.graduation_year || "—"}</p></div>
                <div><p className="text-[10px] uppercase text-muted-foreground">Primary</p><p className="font-semibold">{a.primary_position || "—"}</p></div>
                <div><p className="text-[10px] uppercase text-muted-foreground">Secondary</p><p className="font-semibold truncate">{(a.secondary_positions || []).join(", ") || "—"}</p></div>
                <div><p className="text-[10px] uppercase text-muted-foreground">Bats / Throws</p><p className="font-semibold">{a.bats || "—"} / {a.throws || "—"}</p></div>
                <div><p className="text-[10px] uppercase text-muted-foreground">Height / Weight</p><p className="font-semibold">{a.height || "—"} / {a.weight || "—"}</p></div>
                <div><p className="text-[10px] uppercase text-muted-foreground">Team</p><p className="font-semibold truncate">{a.current_team || "—"}</p></div>
                <div><p className="text-[10px] uppercase text-muted-foreground">Organization</p><p className="font-semibold truncate">{orgName || "—"}</p></div>
                <div><p className="text-[10px] uppercase text-muted-foreground">Last evaluation</p><p className="font-semibold">{lastEvalDate ? String(lastEvalDate).slice(0, 10) : "—"}</p></div>
                {canCoach && (
                  <>
                    <div><p className="text-[10px] uppercase text-muted-foreground">Athlete email</p><p className="font-semibold truncate" data-testid="profile-athlete-email">{a.email || "—"}</p></div>
                    <div><p className="text-[10px] uppercase text-muted-foreground">Guardian</p><p className="font-semibold truncate">{a.guardian_email || a.guardian_name || "—"}</p></div>
                  </>
                )}
                <div>
                  <p className="text-[10px] uppercase text-muted-foreground">Profile</p>
                  <p className="font-semibold text-brand font-mono-num">{completion.pct}% complete</p>
                </div>
              </div>
              {completion.missing.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">Missing: {completion.missing.join(" · ")}</p>
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>
      </Card>

      {/* KPI row — the sketch order: evaluation, development, headline verified
          metrics (only when the athlete actually has them), goal, completion.
          Missing headline metrics fall back to real counts, never invented values. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3" data-testid="profile-quick-cards">
        <Card className="rounded-2xl border-border"><CardContent className="py-4 text-center">
          <p className="text-2xl font-bold font-mono-num text-foreground">{summary.latest_overall ?? "—"}</p>
          <p className="text-[10px] uppercase text-muted-foreground mt-1">Current evaluation</p>
        </CardContent></Card>
        <Card className="rounded-2xl border-brand/40 bg-brand/5" data-testid="kpi-development"><CardContent className="py-4 text-center">
          <p className={`text-2xl font-bold font-mono-num flex items-center justify-center gap-1 ${change > 0 ? "text-success" : change < 0 ? "text-destructive" : "text-muted-foreground"}`}>
            {change > 0 ? <TrendingUp className="h-5 w-5" /> : change < 0 ? <TrendingDown className="h-5 w-5" /> : <Minus className="h-5 w-5" />}
            {change != null ? `${change > 0 ? "+" : ""}${change}` : "—"}
          </p>
          <p className="text-[10px] uppercase text-brand font-bold mt-1">Development</p>
        </CardContent></Card>
        {exitVeloKpi ? (
          <Card className="rounded-2xl border-border" data-testid="kpi-exit-velocity"><CardContent className="py-4 text-center">
            <p className="text-2xl font-bold font-mono-num text-foreground">{exitVeloKpi.value}<span className="text-sm font-semibold text-muted-foreground ml-1">{exitVeloKpi.unit}</span></p>
            <p className="text-[10px] uppercase text-muted-foreground mt-1">Exit velocity{exitVeloKpi.isBest ? " · best" : ""}</p>
            {exitVeloKpi.source && <div className="mt-1 flex justify-center"><VerificationBadge source={exitVeloKpi.source} compact /></div>}
          </CardContent></Card>
        ) : (
          <Card className="rounded-2xl border-border"><CardContent className="py-4 text-center">
            <p className="text-2xl font-bold font-mono-num">{metricCount}</p>
            <p className="text-[10px] uppercase text-muted-foreground mt-1">Verified metrics</p>
          </CardContent></Card>
        )}
        {sixtyKpi ? (
          <Card className="rounded-2xl border-border" data-testid="kpi-sixty-yard"><CardContent className="py-4 text-center">
            <p className="text-2xl font-bold font-mono-num text-foreground">{sixtyKpi.value}<span className="text-sm font-semibold text-muted-foreground ml-1">{sixtyKpi.unit}</span></p>
            <p className="text-[10px] uppercase text-muted-foreground mt-1">60-yard{sixtyKpi.isBest ? " · best" : ""}</p>
            {sixtyKpi.source && <div className="mt-1 flex justify-center"><VerificationBadge source={sixtyKpi.source} compact /></div>}
          </CardContent></Card>
        ) : (
          <Card className="rounded-2xl border-border"><CardContent className="py-4 text-center">
            <p className="text-2xl font-bold font-mono-num">{summary.evaluation_count ?? 0}</p>
            <p className="text-[10px] uppercase text-muted-foreground mt-1">Evaluations</p>
          </CardContent></Card>
        )}
        <Card className="rounded-2xl border-border"><CardContent className="py-4 text-center px-2">
          <p className="text-sm font-bold truncate">{activeGoal?.title || "—"}</p>
          <p className="text-[10px] uppercase text-muted-foreground mt-1">Current goal</p>
        </CardContent></Card>
        <Card className="rounded-2xl border-border"><CardContent className="py-4 text-center">
          <p className="text-2xl font-bold font-mono-num text-brand">{completion.pct}%</p>
          <p className="text-[10px] uppercase text-muted-foreground mt-1">Profile complete</p>
        </CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <div className="overflow-x-auto -mx-4 px-4">
          <TabsList className="rounded-xl bg-secondary h-11 w-max">
            {PROFILE_TABS.map((t) => (
              <TabsTrigger key={t} value={t} className="rounded-lg px-3.5 data-[state=active]:bg-primary data-[state=active]:text-white" data-testid={`profile-tab-${t}`}>
                {TAB_LABELS[t] || t}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* ---- Overview ---- */}
        {/* Development-first: the change headline and progress story render
            before rankings-flavored content (strengths/needs, skill radar). */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {change != null && (
            <Card className="rounded-2xl border-brand/40 bg-brand/5" data-testid="development-headline">
              <CardContent className="py-4 flex items-center gap-4">
                {change > 0 ? <TrendingUp className="h-9 w-9 text-success shrink-0" /> : change < 0 ? <TrendingDown className="h-9 w-9 text-destructive shrink-0" /> : <Minus className="h-9 w-9 text-muted-foreground shrink-0" />}
                <div className="min-w-0">
                  <p className={`font-mono-num font-bold text-3xl ${change > 0 ? "text-success" : change < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {change > 0 ? "+" : ""}{change}{change === 0 ? " — holding steady" : " this season"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Overall evaluation {prevScore != null ? `moved from ${Math.round(prevScore * 100) / 100} to ${summary.latest_overall}` : "change"} since the previous event.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="rounded-2xl border-border">
              <CardContent className="pt-4 pb-2">
                <p className="font-semibold text-sm text-foreground mb-1">Score Trend</p>
                {trendData.length >= 2 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={trendData} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                      <CartesianGrid stroke="hsl(var(--divider))" strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="score" stroke="hsl(var(--destructive))" strokeWidth={2.5} dot={{ r: 4, fill: "hsl(var(--destructive))" }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground py-8 text-center">No trend yet — complete more evaluation events to see progress over time.</p>
                )}
              </CardContent>
            </Card>
            {prevScore != null && summary.latest_overall != null && (
              <Card className="rounded-2xl border-border"><CardContent className="pt-4 pb-3">
                <p className="font-semibold text-sm text-foreground mb-1">Previous vs current</p>
                <ResponsiveContainer width="100%" height={100}>
                  <BarChart data={compareBar} layout="vertical" margin={{ left: 10, right: 10 }}>
                    <XAxis type="number" domain={[0, 10]} hide />
                    <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 11 }} />
                    <Bar dataKey="score" fill="hsl(var(--brand))" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent></Card>
            )}
          </div>

          {(summary.goals || []).length > 0 && (
            <Card className="rounded-2xl border-border">
              <CardContent className="pt-4 pb-4 space-y-3">
                <p className="font-semibold text-sm text-foreground">Current Development Goals</p>
                {summary.goals.slice(0, 3).map((g) => (
                  <div key={g.id} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{g.title}</p>
                      <Progress value={g.progress} className="h-2 mt-1" />
                    </div>
                    <StatusBadge status={g.status} />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {growthRows.length > 0 && (
            <Card className="rounded-2xl border-border" data-testid="metric-growth-card">
              <CardContent className="pt-4 pb-4">
                <p className="font-semibold text-sm text-foreground mb-1">Metric Growth (trainer view)</p>
                <p className="text-xs text-muted-foreground">
                  {growthRows.length} tracked {growthRows.length === 1 ? "metric" : "metrics"} ·{" "}
                  <span className="text-success font-semibold">{improvedCount} improved</span> ·{" "}
                  <span className="text-destructive font-semibold">{declinedCount} declined</span>
                </p>
                <Collapsible>
                  <CollapsibleTrigger className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-info hover:underline [&[data-state=open]>svg]:rotate-180" data-testid="metric-growth-expander">
                    View Full Report <ChevronDown className="h-3.5 w-3.5" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                <div className="overflow-x-auto pt-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b">
                        <th className="py-2 pr-3 font-semibold">Metric</th>
                        <th className="py-2 pr-3 font-semibold">First</th>
                        <th className="py-2 pr-3 font-semibold">Latest</th>
                        <th className="py-2 font-semibold">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.metric_history.slice(0, 12).map((m) => (
                        <tr key={m.key} className="border-b border-[hsl(var(--divider))] last:border-0">
                          <td className="py-2.5 pr-3">
                            <span className="font-medium text-foreground">{m.name}</span>
                            {m.unit ? <span className="text-muted-foreground text-xs ml-1">{m.unit}</span> : null}
                          </td>
                          <td className="py-2.5 pr-3 font-mono-num text-muted-foreground">{m.first ?? "—"}</td>
                          <td className="py-2.5 pr-3 font-mono-num font-semibold text-foreground">{m.latest ?? "—"}</td>
                          <td className="py-2.5">
                            {m.change === null || m.change === undefined ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span className={`inline-flex items-center gap-1 font-mono-num font-semibold ${m.improved ? "text-success" : m.change === 0 ? "text-muted-foreground" : "text-destructive"}`}>
                                {m.improved ? <TrendingUp className="h-3.5 w-3.5" /> : m.change === 0 ? <Minus className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                                {m.change > 0 ? "+" : ""}{m.change}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>
          )}

          {rankedCats.length > 0 && (
            <Card className="rounded-2xl border-border" data-testid="strengths-needs-card">
              <CardContent className="pt-4 pb-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-success font-semibold mb-1.5">Strongest skills</p>
                  <ul className="space-y-1" data-testid="overview-strengths">
                    {topStrengths.map((c) => (
                      <li key={c.name} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate">{c.name}</span>
                        <span className="font-mono-num font-semibold text-foreground">{c.score}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-warning font-semibold mb-1.5">Main development needs</p>
                  {topNeeds.length > 0 ? (
                    <ul className="space-y-1" data-testid="overview-needs">
                      {topNeeds.map((c) => (
                        <li key={c.name} className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate">{c.name}</span>
                          <span className="font-mono-num font-semibold text-foreground">{c.score}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">More scored categories are needed to rank development needs.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="rounded-2xl border-border">
              <CardContent className="pt-4 pb-2">
                <p className="font-semibold text-sm text-foreground mb-1">Skill Categories</p>
                {radarData.length >= 3 ? (
                  <IdRadarChart data={radarData} height={260} />
                ) : radarData.length > 0 ? (
                  <div className="space-y-2.5 py-2">
                    {radarData.map((d) => (
                      <div key={d.category}>
                        <div className="flex justify-between text-xs mb-1"><span className="font-medium">{d.category}</span><span className="font-mono-num">{d.score}</span></div>
                        <Progress value={d.score * 10} className="h-2" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-8 text-center">No scored evaluations yet.</p>
                )}
              </CardContent>
            </Card>
            <Card className="rounded-2xl border-border">
              <CardContent className="pt-4 pb-4">
                <p className="font-semibold text-sm text-foreground mb-2">Profile completion</p>
                <Progress value={completion.pct} className="h-3" />
                <p className="text-2xl font-bold font-mono-num text-brand mt-2">{completion.pct}%</p>
                <ul className="mt-2 space-y-1" data-testid="completion-checklist">
                  {completion.checks.map((c) => (
                    <li key={c.key} className="flex items-center gap-1.5 text-xs">
                      {c.ok
                        ? <Check className="h-3.5 w-3.5 text-success shrink-0" />
                        : <X className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                      <span className={c.ok ? "text-muted-foreground" : "text-foreground"}>{c.label}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          {summary.latest_scout_assessment && (
            <Card className="rounded-2xl border-border" data-testid="scout-assessment-card">
              <CardContent className="pt-4 pb-4">
                <p className="font-semibold text-sm text-foreground flex items-center gap-2"><Flag className="h-4 w-4 text-destructive" /> Latest Head Scout Assessment</p>
                <p className="text-xs text-muted-foreground mt-1">{summary.latest_scout_assessment.author_name} · {summary.latest_scout_assessment.assessment_date}</p>
                <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{summary.latest_scout_assessment.summary}</p>
                <Collapsible>
                  <CollapsibleTrigger className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-info hover:underline [&[data-state=open]>svg]:rotate-180" data-testid="scout-assessment-expander">
                    View Details <ChevronDown className="h-3.5 w-3.5" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="pt-2 space-y-2 text-sm text-muted-foreground">
                      <p className="whitespace-pre-line">{summary.latest_scout_assessment.summary}</p>
                      {summary.latest_scout_assessment.position_recommendation && (
                        <p><span className="font-semibold text-foreground">Position projection:</span> {summary.latest_scout_assessment.position_recommendation}</p>
                      )}
                      {summary.latest_scout_assessment.development_recommendation && (
                        <p><span className="font-semibold text-foreground">Development recommendation:</span> {summary.latest_scout_assessment.development_recommendation}</p>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>
          )}

        </TabsContent>

        {/* ---- Evaluations ---- */}
        <TabsContent value="evaluations" className="mt-4 space-y-3">
          {(summary.event_scores || []).length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {summary.event_scores.map((es) => (
                <Card key={es.event_id} className="rounded-2xl border-border">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-sm text-foreground">{es.event_name}</p>
                        <p className="text-xs text-muted-foreground">{es.event_date}</p>
                      </div>
                      <p className="font-mono-num font-bold text-2xl text-foreground">{es.overall_score ?? "—"}</p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {Object.entries(es.category_scores || {}).map(([c, d]) => (
                        <span key={c} className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{c}: {d.score}</span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {!evaluations ? <Skeleton className="h-32 rounded-2xl" /> : evaluations.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No evaluations visible" hint="Submitted evaluations for this player will appear here." />
          ) : (
            <div className="space-y-2">
              {evaluations.map((ev) => (
                <Card key={ev.id} className="rounded-2xl border-border">
                  <CardContent className="py-3.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{ev.station_name} — {ev.event_name}</p>
                      <p className="text-xs text-muted-foreground">By {ev.evaluator_name} · {(ev.submitted_at || ev.updated_at || "").slice(0, 10)}</p>
                    </div>
                    <p className="font-mono-num font-bold text-foreground">{ev.computed?.overall_score ?? "—"}</p>
                    <StatusBadge status={ev.status} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ---- Verified metrics ---- */}
        <TabsContent value="verified" className="mt-4 space-y-3" data-testid="profile-verified-tab">
          {canCoach && (
            <Card className="rounded-2xl border-border">
              <CardContent className="py-4 space-y-3">
                <p className="font-semibold text-sm flex items-center gap-2"><Gauge className="h-4 w-4 text-brand" /> Log verified metric</p>
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                  <Select value={metricForm.metric_key} onValueChange={(v) => setMetricForm((f) => ({ ...f, metric_key: v }))}>
                    <SelectTrigger className="h-10 rounded-lg" data-testid="metric-key-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(catalog.length ? catalog.filter((c) => !c.legacy) : [
                        { key: "exit_velo", label: "Exit Velocity" },
                        { key: "pitch_velo", label: "Pitch Velocity" },
                        { key: "sixty_yd", label: "60-Yard Dash" },
                      ]).map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="number" step="0.01" placeholder="Value" value={metricForm.value} onChange={(e) => setMetricForm((f) => ({ ...f, value: e.target.value }))} className="h-10 rounded-lg" data-testid="metric-value-input" />
                  <Input type="date" value={metricForm.measured_at} onChange={(e) => setMetricForm((f) => ({ ...f, measured_at: e.target.value }))} className="h-10 rounded-lg" />
                  <Select value={metricForm.source} onValueChange={(v) => setMetricForm((f) => ({ ...f, source: v }))}>
                    <SelectTrigger className="h-10 rounded-lg" data-testid="metric-source-select"><SelectValue placeholder="Source" /></SelectTrigger>
                    <SelectContent>
                      {(sources.length ? sources.map((s) => ({ value: s.key, label: s.label })) : METRIC_SOURCES)
                        .map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button className="rounded-xl bg-primary h-10" disabled={metricBusy || !metricForm.value} onClick={logMetric} data-testid="metric-log-button">
                    {metricBusy ? "Saving…" : "Log metric"}
                  </Button>
                </div>
                {metricError && <p className="text-xs text-destructive" data-testid="metric-log-error">{metricError}</p>}
              </CardContent>
            </Card>
          )}
          {!milestones ? null : milestones.length > 0 && (
            <Card className="rounded-2xl border-border">
              <CardContent className="py-4 space-y-2">
                <p className="font-semibold text-sm">Milestones</p>
                {milestones.slice(0, 10).map((ms) => (
                  <div key={ms.id} className="text-sm border-b border-divider pb-2 last:border-0">
                    <p className="font-semibold">{ms.label}</p>
                    <p className="text-xs text-muted-foreground">{ms.detail}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {(comparison || []).length > 0 && (
            <div className="space-y-2" data-testid="metric-comparison-list">
              {comparison.map((item) => <MetricComparisonCard key={item.metric_key} item={item} />)}
            </div>
          )}
          {!metrics ? <Skeleton className="h-32 rounded-2xl" /> : metrics.length === 0 ? (
            <EmptyState icon={Gauge} title="No verified metrics" hint="Coaches can log exit velo, 60-yard, pop time, and other objective measures." />
          ) : (comparison || []).length > 0 ? (
            <Collapsible>
              <CollapsibleTrigger className="inline-flex items-center gap-1 text-xs font-semibold text-info hover:underline [&[data-state=open]>svg]:rotate-180" data-testid="metric-log-expander">
                View Details — all logged measurements ({metrics.length}) <ChevronDown className="h-3.5 w-3.5" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-2 pt-2">{metrics.map((m) => <MetricRow key={m.id} m={m} />)}</div>
              </CollapsibleContent>
            </Collapsible>
          ) : (
            <div className="space-y-2">
              {metrics.map((m) => <MetricRow key={m.id} m={m} />)}
            </div>
          )}
        </TabsContent>

        {/* ---- Development ---- */}
        <TabsContent value="development" className="mt-4 space-y-3">
          {canCoach && (
            <div className="flex flex-wrap gap-2">
              <AddGoalDialog athleteId={athleteId} onDone={() => { setGoals(null); loadSummary(); }} />
              <AddAssessmentDialog athleteId={athleteId} onDone={refreshAll} />
              {canReview && <ScoutAssessmentDialog athleteId={athleteId} onDone={refreshAll} />}
              <Button variant="outline" className="rounded-xl h-10" disabled={planBusy} onClick={generatePlan} data-testid="generate-plan-button">
                <Sparkles className="h-4 w-4 mr-1" /> {planBusy ? "Generating…" : "Generate plan"}
              </Button>
            </div>
          )}
          {plan && plan !== false && (
            <Card className="rounded-2xl border-border" data-testid="development-plan-card">
              <CardContent className="py-4 space-y-3">
                <p className="font-semibold text-sm">Latest development plan</p>
                <p className="text-sm text-muted-foreground">{plan.ninety_day_plan}</p>
                <div className="grid sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Strengths</p>
                    <ul className="list-disc pl-4">{(plan.strengths || []).map((s) => <li key={s}>{s}</li>)}</ul>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Priorities</p>
                    <ul className="list-disc pl-4">{(plan.priorities || []).map((s) => <li key={s}>{s}</li>)}</ul>
                  </div>
                </div>
                {(plan.drills || []).length > 0 && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Drills</p>
                    <ul className="space-y-1">
                      {plan.drills.map((d) => (
                        <li key={d.id} className="text-sm"><span className="font-semibold">{d.name}</span> — {d.description}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          {!goals ? <Skeleton className="h-32 rounded-2xl" /> : goals.length === 0 ? (
            <EmptyState icon={Target} title="No development goals" hint="Coaches can create goals to track player progress between events." />
          ) : (
            <div className="space-y-2">
              {goals.map((g) => (
                <Card key={g.id} className="rounded-2xl border-border">
                  <CardContent className="py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">{g.title}</p>
                        <p className="text-xs text-muted-foreground">{g.category || "General"} · Coach: {g.assigned_coach_name || "—"} {g.target_date && `· Target: ${g.target_date}`}</p>
                      </div>
                      <StatusBadge status={g.status} />
                    </div>
                    {g.description && <p className="text-sm text-muted-foreground mt-2">{g.description}</p>}
                    <div className="mt-3 flex items-center gap-3">
                      <Progress value={g.progress} className="h-2.5 flex-1" />
                      <span className="text-xs font-mono-num text-muted-foreground">{g.progress}%</span>
                    </div>
                    {canCoach && g.status !== "Archived" && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Select value={g.status} onValueChange={(v) => updateGoal(g.id, { status: v })}>
                          <SelectTrigger className="h-9 w-[160px] rounded-lg text-xs" data-testid={`goal-status-select-${g.id}`}><SelectValue /></SelectTrigger>
                          <SelectContent>{GOAL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                        </Select>
                        <Select value={String(g.progress)} onValueChange={(v) => updateGoal(g.id, { progress: parseInt(v) })}>
                          <SelectTrigger className="h-9 w-[110px] rounded-lg text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{[0, 10, 25, 40, 50, 60, 75, 90, 100].map((p) => <SelectItem key={p} value={String(p)}>{p}%</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ---- Awards ---- */}
        <TabsContent value="awards" className="mt-4 space-y-3" data-testid="profile-awards-tab">
          {canCoach && (
            <Card className="rounded-2xl border-border">
              <CardContent className="py-4 space-y-3">
                <p className="font-semibold text-sm flex items-center gap-2"><Trophy className="h-4 w-4 text-brand" /> Submit award</p>
                <div className="grid sm:grid-cols-3 gap-2">
                  <Input placeholder="Title" value={awardForm.title} onChange={(e) => setAwardForm((f) => ({ ...f, title: e.target.value }))} className="h-10 rounded-lg" data-testid="award-title-input" />
                  <Select value={awardForm.category} onValueChange={(v) => setAwardForm((f) => ({ ...f, category: v }))}>
                    <SelectTrigger className="h-10 rounded-lg"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["defense", "offense", "overall", "milestone", "athleticism"].map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button className="rounded-xl bg-primary h-10" disabled={awardBusy || !awardForm.title.trim()} onClick={submitAward} data-testid="award-submit-button">
                    {awardBusy ? "Submitting…" : "Submit"}
                  </Button>
                </div>
                <Input placeholder="Description (optional)" value={awardForm.description} onChange={(e) => setAwardForm((f) => ({ ...f, description: e.target.value }))} className="h-10 rounded-lg" />
              </CardContent>
            </Card>
          )}
          {!awards ? <Skeleton className="h-32 rounded-2xl" /> : awards.length === 0 ? (
            <EmptyState icon={Trophy} title="No awards yet" hint="Staff can submit awards for admin/head scout approval." />
          ) : (
            <div className="space-y-2">
              {awards.map((aw) => (
                <Card key={aw.id} className="rounded-2xl border-border">
                  <CardContent className="py-3.5 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm">{aw.title}</p>
                      <p className="text-xs text-muted-foreground capitalize">{aw.category} · {aw.status} · {aw.submitted_by_name}</p>
                      {aw.description && <p className="text-xs text-muted-foreground mt-1">{aw.description}</p>}
                    </div>
                    {canReview && aw.status === "pending" && (
                      <div className="flex gap-2">
                        <Button size="sm" className="rounded-lg h-8" onClick={() => decideAward(aw.id, true)} data-testid={`award-approve-${aw.id}`}>Approve</Button>
                        <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => decideAward(aw.id, false)}>Reject</Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ---- Media ---- */}
        <TabsContent value="media" className="mt-4 space-y-3">
          {canCoach && <UploadPhotoDialog athleteId={athleteId} onDone={() => { loadMedia(); loadSummary(); }} />}
          {!media ? <Skeleton className="h-32 rounded-2xl" /> : media.length === 0 ? (
            <EmptyState icon={ImageIcon} title="No media yet" hint="Photos and videos uploaded during evaluations appear here. Consent is required for all uploads." />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {media.map((m) => (
                <Card key={m.id} className="rounded-2xl border-border overflow-hidden">
                  {m.file_type === "photo" ? (
                    <img src={signedUrl(`/media/${m.id}/file`)} alt={m.description || m.file_name} className="w-full h-36 object-cover" />
                  ) : (
                    <video src={signedUrl(`/media/${m.id}/file`)} controls className="w-full h-36 object-cover bg-black" />
                  )}
                  <CardContent className="py-2.5 space-y-1.5">
                    <p className="text-xs font-medium truncate">{m.description || m.file_name}</p>
                    <p className="text-[10px] text-muted-foreground">{m.uploaded_by_name} · {(m.created_at || "").slice(0, 10)}</p>
                    {m.consent_status === "pending_consent" && (
                      <div className="space-y-1">
                        <p className="text-[10px] font-semibold text-warning">Pending consent</p>
                        {canCoach && (
                          <div className="flex gap-1">
                            <Button size="sm" className="h-7 rounded-md text-[10px] px-2" onClick={() => resolveMediaConsent(m.id, true)}>Approve</Button>
                            <Button size="sm" variant="outline" className="h-7 rounded-md text-[10px] px-2" onClick={() => resolveMediaConsent(m.id, false)}>Reject</Button>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ---- Staff Notes ---- */}
        <TabsContent value="notes" className="mt-4 space-y-3">
          {!notes ? <Skeleton className="h-32 rounded-2xl" /> : notes.length === 0 ? (
            <EmptyState icon={StickyNote} title="No staff notes" hint="Coach assessments and scout notes appear here." />
          ) : (
            <div className="space-y-2">
              {notes.map((n) => (
                <Card key={n.id} className="rounded-2xl border-border">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-sm text-foreground">
                        {noteTypeLabel(n)}
                        {(n.note_type || n.visibility) && (
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                            {(n.visibility || n.note_type || "").replace(/_/g, " ")}
                          </span>
                        )}
                        {n.confidential && <span className="ml-2 text-[10px] text-destructive uppercase">Confidential</span>}
                      </p>
                      <span className="text-xs text-muted-foreground shrink-0">{n.assessment_date || (n.created_at || "").slice(0, 10)}</span>
                    </div>
                    {n.assessment_type && n.note_type !== "scout" && n.note_type !== "scout_assessment" && (
                      <p className="text-xs text-muted-foreground mt-1">{n.assessment_type}</p>
                    )}
                    {n.summary && <p className="text-sm text-muted-foreground mt-1.5">{n.summary}</p>}
                    {n.parent_visible_note && <p className="text-sm mt-1.5"><span className="font-semibold text-info">Parent note:</span> {n.parent_visible_note}</p>}
                    {n.internal_note && <p className="text-sm mt-1.5"><span className="font-semibold text-destructive">Internal:</span> {n.internal_note}</p>}
                    {n.strengths && <p className="text-sm mt-1.5"><span className="font-semibold text-success">Strengths:</span> {n.strengths}</p>}
                    {n.development_priorities && <p className="text-sm mt-1"><span className="font-semibold text-warning">Development:</span> {n.development_priorities}</p>}
                    {n.recommended_drills && <p className="text-sm mt-1"><span className="font-semibold text-muted-foreground">Drills:</span> {n.recommended_drills}</p>}
                    {n.development_recommendation && <p className="text-sm mt-1"><span className="font-semibold text-muted-foreground">Recommendation:</span> {n.development_recommendation}</p>}
                    <p className="text-xs text-muted-foreground mt-2">{n.author_name} ({n.author_role?.replace("_", " ")})</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ---- Progress ---- */}
        <TabsContent value="progress" className="mt-4 space-y-4">
          <Card className="rounded-2xl border-border">
            <CardContent className="pt-4 pb-2">
              <p className="font-semibold text-sm text-foreground mb-1">Score over time</p>
              {trendData.length >= 2 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={trendData} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                    <CartesianGrid stroke="hsl(var(--divider))" strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="score" stroke="hsl(var(--brand))" strokeWidth={2.5} dot={{ r: 4, fill: "hsl(var(--brand))" }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">Complete more evaluation events to see progress.</p>
              )}
            </CardContent>
          </Card>
          {prevScore != null && summary.latest_overall != null && (
            <Card className="rounded-2xl border-border">
              <CardContent className="pt-4 pb-4">
                <p className="font-semibold text-sm mb-2">Previous vs current</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={compareBar}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" />
                    <YAxis domain={[0, 10]} />
                    <Tooltip />
                    <Bar dataKey="score" fill="hsl(var(--brand))" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
          {(summary.metric_history || []).length > 0 && (
            <Card className="rounded-2xl border-border">
              <CardContent className="pt-4 pb-4">
                <p className="font-semibold text-sm mb-3">Metric growth</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b">
                        <th className="py-2 pr-3">Metric</th>
                        <th className="py-2 pr-3">First</th>
                        <th className="py-2 pr-3">Latest</th>
                        <th className="py-2">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.metric_history.slice(0, 12).map((m) => (
                        <tr key={m.key} className="border-b border-divider last:border-0">
                          <td className="py-2.5 pr-3 font-medium">{m.name}</td>
                          <td className="py-2.5 pr-3 font-mono-num text-muted-foreground">{m.first ?? "—"}</td>
                          <td className="py-2.5 pr-3 font-mono-num font-semibold">{m.latest ?? "—"}</td>
                          <td className="py-2.5 font-mono-num">{m.change == null ? "—" : `${m.change > 0 ? "+" : ""}${m.change}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ---- Player Story (timeline) ---- */}
        <TabsContent value="story" className="mt-4">
          {!timeline ? <Skeleton className="h-40 rounded-2xl" /> : timeline.length === 0 ? (
            <EmptyState icon={CalendarClock} title="No story yet" hint="Evaluations, goals, media, and milestones build the player's story." />
          ) : (
            <div className="space-y-2" data-testid="player-timeline">
              {timeline.map((t, i) => <TimelineItem key={i} entry={t} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="events" className="mt-4 space-y-2">
          {(summary.event_scores || []).length === 0 ? (
            <EmptyState icon={ClipboardList} title="No events yet" hint="Event evaluations for this player appear here." />
          ) : (summary.event_scores || []).map((es) => (
            <Card key={es.event_id} className="rounded-2xl border-border">
              <CardContent className="py-4 flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-sm">{es.event_name}</p>
                  <p className="text-xs text-muted-foreground">{es.event_date}</p>
                </div>
                <p className="font-mono-num font-bold text-2xl">{es.overall_score ?? "—"}</p>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="seasons" className="mt-4" data-testid="profile-seasons-tab">
          <SeasonsPanel athleteId={athleteId} canEdit={canCoach} summary={summary} catalog={catalog} />
        </TabsContent>

        <TabsContent value="rankings" className="mt-4">
          <EmptyState icon={Trophy} title="Rankings" hint="Event and category rankings for this player will appear here as reports expand." />
        </TabsContent>

        <TabsContent value="private" className="mt-4">
          {canReview || isAdmin ? (
            <Card className="rounded-2xl border-border">
              <CardContent className="py-4 space-y-2 text-sm">
                <p className="font-semibold">Private information</p>
                <p className="text-muted-foreground text-xs">Visible only to authorized staff.</p>
                <div className="grid sm:grid-cols-2 gap-3 pt-2">
                  <div><p className="text-[10px] uppercase text-muted-foreground">Guardian email</p><p>{a.guardian_email || a.parent_email || "—"}</p></div>
                  <div><p className="text-[10px] uppercase text-muted-foreground">Athlete email</p><p>{a.email || "—"}</p></div>
                  <div><p className="text-[10px] uppercase text-muted-foreground">Phone</p><p>{a.phone || a.guardian_phone || "—"}</p></div>
                  <div><p className="text-[10px] uppercase text-muted-foreground">City / State</p><p>{a.city || "—"}{a.state ? `, ${a.state}` : ""}</p></div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <EmptyState icon={StickyNote} title="Private information" hint="Only authorized administrators can view private contact details." />
          )}
        </TabsContent>

      </Tabs>
    </div>
  );
}

// Career aggregates are computed only from rows the API actually returned —
// a metric with no known direction in the catalog is skipped, never guessed.
function careerBests(metricRows, catalog) {
  const byKey = {};
  (metricRows || []).forEach((m) => {
    const meta = (catalog || []).find((c) => c.key === m.metric_key) || {};
    const lower = typeof m.lower_better === "boolean" ? m.lower_better : meta.lower_better;
    // Without a known direction there is no defensible "best" — skip the metric.
    if (typeof lower !== "boolean" || typeof m.value !== "number") return;
    const cur = byKey[m.metric_key];
    if (!cur || (lower ? m.value < cur.value : m.value > cur.value)) {
      byKey[m.metric_key] = {
        key: m.metric_key,
        label: m.label || meta.label || String(m.metric_key).replace(/_/g, " "),
        unit: m.unit || meta.unit,
        value: m.value,
        measured_at: m.measured_at,
        source: m.source,
      };
    }
  });
  return Object.values(byKey);
}

function scoreByYear(eventScores) {
  const acc = {};
  (eventScores || []).forEach((e) => {
    const year = String(e.event_date || "").slice(0, 4);
    if (!/^\d{4}$/.test(year) || typeof e.overall_score !== "number") return;
    acc[year] = acc[year] || { sum: 0, n: 0 };
    acc[year].sum += e.overall_score;
    acc[year].n += 1;
  });
  return Object.entries(acc)
    .map(([year, v]) => ({ year, score: Math.round((v.sum / v.n) * 100) / 100 }))
    .sort((x, y) => x.year.localeCompare(y.year));
}

function SeasonsPanel({ athleteId, canEdit, summary, catalog }) {
  const [seasons, setSeasons] = useState(null);
  const [careerMetrics, setCareerMetrics] = useState([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ year: String(new Date().getFullYear()), team: "", organization_name: "", age_group: "", height: "", weight: "" });

  useEffect(() => {
    api.get(`/athletes/${athleteId}/seasons`)
      .then((r) => setSeasons(r.data || []))
      .catch(() => setSeasons([]));
    api.get(`/metrics/athlete/${athleteId}`)
      .then((r) => setCareerMetrics(r.data || []))
      .catch(() => setCareerMetrics([]));
  }, [athleteId]);

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/athletes/${athleteId}/seasons`, {
        year: parseInt(form.year, 10),
        team: form.team || null,
        organization_name: form.organization_name || null,
        age_group: form.age_group || null,
        height: form.height || null,
        weight: form.weight || null,
      });
      setSeasons((prev) => [r.data, ...(prev || [])]);
      toast.success("Season added.");
    } catch (e) {
      toast.error(errMsg(e, "Could not save season. Backend may still be updating."));
    } finally {
      setBusy(false);
    }
  };

  if (!seasons) return <Skeleton className="h-32 rounded-2xl" />;

  const bests = careerBests(careerMetrics, catalog);
  const yearScores = scoreByYear(summary?.event_scores);
  const teams = Array.from(new Set(
    seasons.map((s) => s.team).concat([summary?.athlete?.current_team]).filter(Boolean)
  ));
  const seasonYears = seasons.map((s) => s.year).filter((y) => y != null);
  const careerSpan = seasonYears.length ? `${Math.min(...seasonYears)}–${Math.max(...seasonYears)}` : null;

  return (
    <div className="space-y-3" data-testid="seasons-panel">
      <p className="text-sm text-muted-foreground">
        One permanent 60&apos;6&quot; ID — each season stacks underneath without erasing history.
      </p>

      <Card className="rounded-2xl border-border" data-testid="career-overview-card">
        <CardContent className="py-4 space-y-4">
          <p className="font-semibold text-sm text-foreground">Career Overview</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl bg-surface-2 border border-border py-3 text-center">
              <p className="text-2xl font-bold font-mono-num">{summary?.evaluation_count ?? 0}</p>
              <p className="text-[10px] uppercase text-muted-foreground mt-1">Career evaluations</p>
            </div>
            <div className="rounded-xl bg-surface-2 border border-border py-3 text-center">
              <p className="text-2xl font-bold font-mono-num">{(summary?.event_scores || []).length}</p>
              <p className="text-[10px] uppercase text-muted-foreground mt-1">Events scored</p>
            </div>
            <div className="rounded-xl bg-surface-2 border border-border py-3 text-center">
              <p className="text-2xl font-bold font-mono-num">{seasons.length}</p>
              <p className="text-[10px] uppercase text-muted-foreground mt-1">Seasons {careerSpan ? `· ${careerSpan}` : ""}</p>
            </div>
            <div className="rounded-xl bg-surface-2 border border-border py-3 text-center">
              <p className="text-2xl font-bold font-mono-num">{careerMetrics.length}</p>
              <p className="text-[10px] uppercase text-muted-foreground mt-1">Verified measurements</p>
            </div>
          </div>

          {teams.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Teams played for</p>
              <div className="flex flex-wrap gap-1.5">
                {teams.map((t) => (
                  <span key={t} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium">{t}</span>
                ))}
              </div>
            </div>
          )}

          {bests.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Best verified measurements</p>
              <div className="grid gap-1.5 sm:grid-cols-2" data-testid="career-bests">
                {bests.map((b) => (
                  <div key={b.key} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 border border-border px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{b.label}</p>
                      <p className="text-[11px] text-muted-foreground">{b.measured_at || "—"}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono-num font-bold text-brand">{b.value} {b.unit}</p>
                      {b.source && <div className="mt-0.5 flex justify-end"><SourceBadge source={b.source} compact /></div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {yearScores.length >= 2 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Overall score by year</p>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={yearScores} margin={{ top: 8, right: 10, bottom: 0, left: -20 }}>
                  <CartesianGrid stroke="hsl(var(--divider))" strokeDasharray="3 3" />
                  <XAxis dataKey="year" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="score" stroke="hsl(var(--brand))" strokeWidth={2.5} dot={{ r: 4, fill: "hsl(var(--brand))" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
      {canEdit && (
        <Card className="rounded-2xl border-border">
          <CardContent className="py-4 space-y-2">
            <p className="font-semibold text-sm">Add season</p>
            <div className="grid sm:grid-cols-3 gap-2">
              <Input value={form.year} onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))} placeholder="Year" className="h-10 rounded-lg" />
              <Input value={form.team} onChange={(e) => setForm((f) => ({ ...f, team: e.target.value }))} placeholder="Team" className="h-10 rounded-lg" />
              <Input value={form.age_group} onChange={(e) => setForm((f) => ({ ...f, age_group: e.target.value }))} placeholder="Age group" className="h-10 rounded-lg" />
              <Input value={form.organization_name} onChange={(e) => setForm((f) => ({ ...f, organization_name: e.target.value }))} placeholder="Organization" className="h-10 rounded-lg" />
              <Input value={form.height} onChange={(e) => setForm((f) => ({ ...f, height: e.target.value }))} placeholder="Height" className="h-10 rounded-lg" />
              <Input value={form.weight} onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))} placeholder="Weight" className="h-10 rounded-lg" />
            </div>
            <Button className="rounded-xl bg-primary h-10" disabled={busy || !form.year} onClick={create}>
              {busy ? "Saving…" : "Save season"}
            </Button>
          </CardContent>
        </Card>
      )}
      {seasons.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No seasons recorded" hint="Add a season to track year-to-year team, size, and age group under this ID." />
      ) : (
        seasons.map((s) => (
          <Card key={s.id} className="rounded-2xl border-border">
            <CardContent className="py-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-display text-2xl text-foreground">{s.year} Season</p>
                <p className="text-sm text-muted-foreground">{s.team || "—"} · {s.organization_name || "—"} · {s.age_group || "—"}</p>
              </div>
              <p className="text-sm font-semibold">{s.height || "—"} / {s.weight || "—"}</p>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
