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
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  ArrowLeft, FileDown, Flag, Plus, TrendingUp, TrendingDown, Minus,
  ClipboardList, Image as ImageIcon, StickyNote, CalendarClock, Target, Archive, Camera,
} from "lucide-react";
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

const ASSESSMENT_TYPES = ["Practice Observation", "Game Observation", "Training Assessment", "Tryout Assessment", "Showcase Assessment", "Development Check-In", "Injury Return Observation", "Position Review", "Scout Follow-Up"];
const GOAL_STATUSES = ["Not Started", "Active", "Improving", "Needs Attention", "Completed", "Archived"];

const AddAssessmentDialog = ({ athleteId, onDone }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ assessment_type: "Practice Observation", strengths: "", development_priorities: "", recommended_drills: "", position_recommendation: "", follow_up_date: "", team_or_program: "" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/athletes/${athleteId}/notes`, { ...form, athlete_id: athleteId });
      toast.success("Assessment added to the player timeline.");
      setOpen(false);
      onDone();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="rounded-xl bg-[#0B1E3A] hover:bg-[#102A4F] h-10" data-testid="add-assessment-button"><Plus className="h-4 w-4 mr-1" /> Add Assessment</Button>
      </DialogTrigger>
      <DialogContent className="rounded-2xl max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display text-2xl text-[#0B1E3A]">Year-to-Date Assessment</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Assessment type</Label>
            <Select value={form.assessment_type} onValueChange={set("assessment_type")}>
              <SelectTrigger className="h-10 rounded-lg" data-testid="assessment-type-select"><SelectValue /></SelectTrigger>
              <SelectContent>{ASSESSMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Team or program</Label><Input value={form.team_or_program} onChange={set("team_or_program")} className="h-10 rounded-lg" /></div>
          <div className="space-y-1"><Label className="text-xs">Strengths</Label><Textarea value={form.strengths} onChange={set("strengths")} rows={2} className="rounded-lg" data-testid="assessment-strengths" /></div>
          <div className="space-y-1"><Label className="text-xs">Development priorities</Label><Textarea value={form.development_priorities} onChange={set("development_priorities")} rows={2} className="rounded-lg" /></div>
          <div className="space-y-1"><Label className="text-xs">Recommended drills</Label><Textarea value={form.recommended_drills} onChange={set("recommended_drills")} rows={2} className="rounded-lg" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">Position recommendation</Label><Input value={form.position_recommendation} onChange={set("position_recommendation")} className="h-10 rounded-lg" /></div>
            <div className="space-y-1"><Label className="text-xs">Follow-up date</Label><Input type="date" value={form.follow_up_date} onChange={set("follow_up_date")} className="h-10 rounded-lg" /></div>
          </div>
        </div>
        <DialogFooter><Button className="w-full rounded-xl bg-[#0B1E3A] h-11" disabled={busy} onClick={submit} data-testid="assessment-submit-button">{busy ? "Saving…" : "Save Assessment"}</Button></DialogFooter>
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
        <DialogHeader><DialogTitle className="font-display text-2xl text-[#0B1E3A]">Development Goal</DialogTitle></DialogHeader>
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
        <DialogFooter><Button className="w-full rounded-xl bg-[#0B1E3A] h-11" disabled={busy || !form.title} onClick={submit} data-testid="goal-submit-button">{busy ? "Saving…" : "Create Goal"}</Button></DialogFooter>
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
        <DialogHeader><DialogTitle className="font-display text-2xl text-[#0B1E3A]">Head Scout Assessment</DialogTitle></DialogHeader>
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
        <DialogFooter><Button className="w-full rounded-xl bg-[#0B1E3A] h-11" disabled={busy || !form.summary} onClick={submit} data-testid="scout-assessment-submit">{busy ? "Saving…" : "Save Assessment"}</Button></DialogFooter>
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
        <DialogHeader><DialogTitle className="font-display text-2xl text-[#0B1E3A]">Upload Media</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input type="file" accept="image/*,video/*" onChange={(e) => setFile(e.target.files?.[0] || null)} className="rounded-xl h-11 pt-2" data-testid="profile-media-file-input" />
          <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder="Description" className="rounded-xl" />
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={isProfile} onCheckedChange={setIsProfile} /> Set as profile photo</label>
          <label className="flex items-start gap-2 text-xs text-slate-600"><Checkbox checked={consent} onCheckedChange={setConsent} className="mt-0.5" data-testid="profile-media-consent" /> I confirm media consent has been verified for this athlete.</label>
        </div>
        <DialogFooter><Button className="w-full rounded-xl bg-[#0B1E3A] h-11" disabled={!file || !consent || busy} onClick={upload} data-testid="profile-media-upload-submit">{busy ? "Uploading…" : "Upload"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const TIMELINE_ICONS = { evaluation: ClipboardList, note: StickyNote, scout_note: Flag, goal: Target, media: ImageIcon };

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

  const role = user?.role;
  const isAdmin = ["owner", "admin"].includes(role);
  const canCoach = ["owner", "admin", "head_scout", "coach"].includes(role);
  const canReview = ["owner", "admin", "head_scout"].includes(role);

  const loadSummary = useCallback(() => {
    api.get(`/athletes/${athleteId}/summary`).then((r) => setSummary(r.data)).catch((e) => { toast.error(errMsg(e)); navigate("/players"); });
  }, [athleteId, navigate]);
  useEffect(loadSummary, [loadSummary]);

  useEffect(() => {
    if (tab === "evaluations" && !evaluations) {
      api.get("/review/queue").then((r) => setEvaluations(r.data.filter((e) => e.athlete_id === athleteId))).catch(() => {
        api.get("/my-evaluations").then((r) => setEvaluations(r.data.filter((e) => e.athlete_id === athleteId))).catch(() => setEvaluations([]));
      });
    }
    if (tab === "notes" && !notes) api.get(`/athletes/${athleteId}/notes`).then((r) => setNotes(r.data)).catch(() => setNotes([]));
    if (tab === "development" && !goals) api.get(`/athletes/${athleteId}/goals`).then((r) => setGoals(r.data)).catch(() => setGoals([]));
    if (tab === "media" && !media) api.get(`/athletes/${athleteId}/media`).then((r) => setMedia(r.data)).catch(() => setMedia([]));
    if (tab === "timeline" && !timeline) api.get(`/athletes/${athleteId}/timeline`).then((r) => setTimeline(r.data)).catch(() => setTimeline([]));
  }, [tab, athleteId, evaluations, notes, goals, media, timeline]);

  const refreshAll = () => {
    loadSummary();
    setNotes(null); setGoals(null); setMedia(null); setTimeline(null);
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
  const trendData = (summary.event_scores || []).map((e) => ({ name: e.event_name?.slice(0, 14) || "Event", date: e.event_date, score: e.overall_score }));
  const change = summary.score_change;

  return (
    <div className="space-y-4">
      <button onClick={() => navigate("/players")} className="inline-flex items-center gap-1 text-sm text-[#1F4AA8] hover:underline" data-testid="profile-back-button">
        <ArrowLeft className="h-3.5 w-3.5" /> Players
      </button>

      {/* Header */}
      <Card className="rounded-2xl card-shadow border-[#E7E1D6] overflow-hidden">
        <div className="hero-sweep px-5 py-5">
          <div className="flex flex-wrap items-center gap-4">
            <PlayerAvatar firstName={a.first_name} lastName={a.last_name} size="xl" />
            <div className="flex-1 min-w-[200px]">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-4xl text-[#0B1E3A]" data-testid="profile-player-name">{a.first_name} {a.last_name}</h1>
                <StatusBadge status={a.status} />
                {a.flagged_follow_up && <span className="inline-flex items-center gap-1 rounded-full bg-[#FDECEC] border border-[#F8B4B4] text-[#7F1D1D] px-2.5 py-0.5 text-xs font-semibold"><Flag className="h-3 w-3" /> Follow-up</span>}
              </div>
              <p className="text-sm text-slate-600 mt-1">
                ID {String(a.id).slice(0, 8).toUpperCase()} · {a.age_group || "—"} · Grad {a.graduation_year || "—"} · {a.primary_position || "—"}
                {(a.secondary_positions || []).length > 0 && ` (${a.secondary_positions.join(", ")})`} · B/T {a.bats || "—"}/{a.throws || "—"}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">{a.current_team || "No team"} · {a.city ? `${a.city}, ${a.state}` : "—"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canReview && <Button variant="outline" className="rounded-xl h-10" onClick={() => window.open(signedUrl(`/reports/player/${athleteId}/pdf`), "_blank")} data-testid="profile-pdf-button"><FileDown className="h-4 w-4 mr-1" /> PDF Report</Button>}
              {isAdmin && a.status === "active" && <Button variant="outline" className="rounded-xl h-10 text-slate-500" onClick={archive} data-testid="profile-archive-button"><Archive className="h-4 w-4 mr-1" /> Archive</Button>}
            </div>
          </div>
        </div>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <div className="overflow-x-auto -mx-4 px-4">
          <TabsList className="rounded-xl bg-[hsl(var(--secondary))] h-11 w-max">
            {["overview", "evaluations", "development", "media", "notes", "timeline"].map((t) => (
              <TabsTrigger key={t} value={t} className="rounded-lg px-3.5 capitalize data-[state=active]:bg-[#0B1E3A] data-[state=active]:text-white" data-testid={`profile-tab-${t}`}>
                {t === "notes" ? "Staff Notes" : t}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* ---- Overview ---- */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="rounded-2xl border-[#E7E1D6]"><CardContent className="py-4 text-center">
              <p className="text-3xl font-bold font-mono-num text-[#0B1E3A]">{summary.latest_overall ?? "—"}</p>
              <p className="text-xs text-slate-500 mt-1">Latest Overall (0-10)</p>
            </CardContent></Card>
            <Card className="rounded-2xl border-[#E7E1D6]"><CardContent className="py-4 text-center">
              <p className={`text-3xl font-bold font-mono-num flex items-center justify-center gap-1 ${change > 0 ? "text-[#1F7A4D]" : change < 0 ? "text-[#C81D25]" : "text-slate-500"}`}>
                {change > 0 ? <TrendingUp className="h-5 w-5" /> : change < 0 ? <TrendingDown className="h-5 w-5" /> : <Minus className="h-5 w-5" />}
                {change !== null && change !== undefined ? Math.abs(change) : "—"}
              </p>
              <p className="text-xs text-slate-500 mt-1">Change vs Previous</p>
            </CardContent></Card>
            <Card className="rounded-2xl border-[#E7E1D6]"><CardContent className="py-4 text-center">
              <p className="text-3xl font-bold font-mono-num text-[#0B1E3A]">{summary.evaluation_count}</p>
              <p className="text-xs text-slate-500 mt-1">Evaluations</p>
            </CardContent></Card>
            <Card className="rounded-2xl border-[#E7E1D6]"><CardContent className="py-4 text-center">
              <p className="text-lg font-bold text-[#0B1E3A]">{summary.position_projection || a.primary_position || "—"}</p>
              <p className="text-xs text-slate-500 mt-1">Position Projection</p>
            </CardContent></Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="rounded-2xl card-shadow border-[#E7E1D6]">
              <CardContent className="pt-4 pb-2">
                <p className="font-semibold text-sm text-[#0B1E3A] mb-1">Skill Categories</p>
                {radarData.length >= 3 ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <RadarChart data={radarData} outerRadius="70%">
                      <PolarGrid stroke="#E7E1D6" />
                      <PolarAngleAxis dataKey="category" tick={{ fontSize: 11, fill: "#475569" }} />
                      <Radar dataKey="score" stroke="#102A4F" fill="#102A4F" fillOpacity={0.25} strokeWidth={2} />
                      <Tooltip />
                    </RadarChart>
                  </ResponsiveContainer>
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
                  <p className="text-sm text-slate-400 py-8 text-center">No scored evaluations yet.</p>
                )}
              </CardContent>
            </Card>
            <Card className="rounded-2xl card-shadow border-[#E7E1D6]">
              <CardContent className="pt-4 pb-2">
                <p className="font-semibold text-sm text-[#0B1E3A] mb-1">Score Trend</p>
                {trendData.length >= 2 ? (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={trendData} margin={{ top: 10, right: 10, bottom: 0, left: -20 }}>
                      <CartesianGrid stroke="#EFE7D7" strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="score" stroke="#C81D25" strokeWidth={2.5} dot={{ r: 4, fill: "#C81D25" }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-slate-400 py-8 text-center">No trend yet — complete more evaluation events to see progress over time.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {summary.latest_scout_assessment && (
            <Card className="rounded-2xl card-shadow border-[#E7E1D6]">
              <CardContent className="pt-4 pb-4">
                <p className="font-semibold text-sm text-[#0B1E3A] flex items-center gap-2"><Flag className="h-4 w-4 text-[#C81D25]" /> Latest Head Scout Assessment</p>
                <p className="text-sm text-slate-600 mt-2">{summary.latest_scout_assessment.summary}</p>
                <p className="text-xs text-slate-400 mt-2">{summary.latest_scout_assessment.author_name} · {summary.latest_scout_assessment.assessment_date}</p>
              </CardContent>
            </Card>
          )}

          {(summary.goals || []).length > 0 && (
            <Card className="rounded-2xl card-shadow border-[#E7E1D6]">
              <CardContent className="pt-4 pb-4 space-y-3">
                <p className="font-semibold text-sm text-[#0B1E3A]">Current Development Goals</p>
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
        </TabsContent>

        {/* ---- Evaluations ---- */}
        <TabsContent value="evaluations" className="mt-4 space-y-3">
          {(summary.event_scores || []).length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {summary.event_scores.map((es) => (
                <Card key={es.event_id} className="rounded-2xl border-[#E7E1D6]">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-sm text-[#0B1E3A]">{es.event_name}</p>
                        <p className="text-xs text-slate-500">{es.event_date}</p>
                      </div>
                      <p className="font-mono-num font-bold text-2xl text-[#0B1E3A]">{es.overall_score ?? "—"}</p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {Object.entries(es.category_scores || {}).map(([c, d]) => (
                        <span key={c} className="rounded-full bg-[hsl(var(--secondary))] px-2 py-0.5 text-[10px] font-semibold text-slate-600">{c}: {d.score}</span>
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
                <Card key={ev.id} className="rounded-2xl border-[#E7E1D6]">
                  <CardContent className="py-3.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#0B1E3A]">{ev.station_name} — {ev.event_name}</p>
                      <p className="text-xs text-slate-500">By {ev.evaluator_name} · {(ev.submitted_at || ev.updated_at || "").slice(0, 10)}</p>
                    </div>
                    <p className="font-mono-num font-bold text-[#0B1E3A]">{ev.computed?.overall_score ?? "—"}</p>
                    <StatusBadge status={ev.status} />
                  </CardContent>
                </Card>
              ))}
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
            </div>
          )}
          {!goals ? <Skeleton className="h-32 rounded-2xl" /> : goals.length === 0 ? (
            <EmptyState icon={Target} title="No development goals" hint="Coaches can create goals to track player progress between events." />
          ) : (
            <div className="space-y-2">
              {goals.map((g) => (
                <Card key={g.id} className="rounded-2xl border-[#E7E1D6]">
                  <CardContent className="py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-[#0B1E3A]">{g.title}</p>
                        <p className="text-xs text-slate-500">{g.category || "General"} · Coach: {g.assigned_coach_name || "—"} {g.target_date && `· Target: ${g.target_date}`}</p>
                      </div>
                      <StatusBadge status={g.status} />
                    </div>
                    {g.description && <p className="text-sm text-slate-600 mt-2">{g.description}</p>}
                    <div className="mt-3 flex items-center gap-3">
                      <Progress value={g.progress} className="h-2.5 flex-1" />
                      <span className="text-xs font-mono-num text-slate-600">{g.progress}%</span>
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

        {/* ---- Media ---- */}
        <TabsContent value="media" className="mt-4 space-y-3">
          {canCoach && <UploadPhotoDialog athleteId={athleteId} onDone={() => { setMedia(null); loadSummary(); }} />}
          {!media ? <Skeleton className="h-32 rounded-2xl" /> : media.length === 0 ? (
            <EmptyState icon={ImageIcon} title="No media yet" hint="Photos and videos uploaded during evaluations appear here. Consent is required for all uploads." />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {media.map((m) => (
                <Card key={m.id} className="rounded-2xl border-[#E7E1D6] overflow-hidden">
                  {m.file_type === "photo" ? (
                    <img src={signedUrl(`/media/${m.id}/file`)} alt={m.description || m.file_name} className="w-full h-36 object-cover" />
                  ) : (
                    <video src={signedUrl(`/media/${m.id}/file`)} controls className="w-full h-36 object-cover bg-black" />
                  )}
                  <CardContent className="py-2.5">
                    <p className="text-xs font-medium truncate">{m.description || m.file_name}</p>
                    <p className="text-[10px] text-slate-400">{m.uploaded_by_name} · {(m.created_at || "").slice(0, 10)}</p>
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
                <Card key={n.id} className="rounded-2xl border-[#E7E1D6]">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-sm text-[#0B1E3A]">
                        {n.note_type === "scout_assessment" ? "Head Scout Assessment" : n.assessment_type}
                        {n.confidential && <span className="ml-2 text-[10px] text-[#C81D25] uppercase">Confidential</span>}
                      </p>
                      <span className="text-xs text-slate-400">{n.assessment_date || (n.created_at || "").slice(0, 10)}</span>
                    </div>
                    {n.summary && <p className="text-sm text-slate-600 mt-1.5">{n.summary}</p>}
                    {n.strengths && <p className="text-sm mt-1.5"><span className="font-semibold text-[#1F7A4D]">Strengths:</span> {n.strengths}</p>}
                    {n.development_priorities && <p className="text-sm mt-1"><span className="font-semibold text-[#B45309]">Development:</span> {n.development_priorities}</p>}
                    {n.recommended_drills && <p className="text-sm mt-1"><span className="font-semibold text-slate-500">Drills:</span> {n.recommended_drills}</p>}
                    {n.development_recommendation && <p className="text-sm mt-1"><span className="font-semibold text-slate-500">Recommendation:</span> {n.development_recommendation}</p>}
                    <p className="text-xs text-slate-400 mt-2">{n.author_name} ({n.author_role?.replace("_", " ")})</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ---- Timeline ---- */}
        <TabsContent value="timeline" className="mt-4">
          {!timeline ? <Skeleton className="h-40 rounded-2xl" /> : timeline.length === 0 ? (
            <EmptyState icon={CalendarClock} title="No history yet" hint="Evaluations, assessments, goals, and media build the player's permanent timeline." />
          ) : (
            <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-px before:bg-[#E6D9C2]" data-testid="player-timeline">
              {timeline.map((t, i) => {
                const Icon = TIMELINE_ICONS[t.type] || StickyNote;
                return (
                  <div key={i} className="relative">
                    <span className="absolute -left-6 top-0.5 h-4 w-4 rounded-full bg-white border-2 border-[#102A4F] flex items-center justify-center" />
                    <div className="rounded-2xl bg-white border border-[#E7E1D6] px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-[#0B1E3A] flex items-center gap-1.5"><Icon className="h-3.5 w-3.5 text-[#1F4AA8]" /> {t.title}</p>
                        <span className="text-xs text-slate-400 whitespace-nowrap">{(t.date || "").slice(0, 10)}</span>
                      </div>
                      {t.detail && <p className="text-xs text-slate-500 mt-1">{t.detail}</p>}
                      {t.author && <p className="text-[11px] text-slate-400 mt-0.5">{t.author}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
