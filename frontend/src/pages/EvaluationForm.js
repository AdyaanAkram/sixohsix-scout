import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { SaveStatusPill } from "@/components/common/SaveStatusPill";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ArrowLeft, ChevronLeft, ChevronRight, EyeOff, Camera, CheckCircle2, Lock, Send } from "lucide-react";
import { cn } from "@/lib/utils";

const QUICK_TAGS = ["Hustle", "Great attitude", "Quick hands", "Strong arm", "Needs reps", "High motor", "Raw but projectable", "Team leader"];

const draftKey = (id) => `pbg_draft_${id}`;

const RatingControl = ({ metric, entry, onChange, max = 5 }) => {
  const value = entry?.value;
  const notObserved = entry?.not_observed;
  const scale = metric.metric_type === "rating_10" ? 10 : 5;
  const values = Array.from({ length: scale }, (_, i) => i + 1);
  return (
    <div>
      <div className={cn("grid gap-1.5", scale === 5 ? "grid-cols-5" : "grid-cols-5 sm:grid-cols-10")}>
        {values.map((v) => (
          <button
            key={v}
            type="button"
            disabled={notObserved}
            onClick={() => onChange({ ...entry, value: entry?.value === v ? null : v, not_observed: false })}
            data-testid={`rating-${metric.key || metric.id}-toggle-${v}`}
            className={cn(
              "h-14 rounded-xl border text-lg font-bold transition-all duration-150 active:scale-[0.96]",
              value === v
                ? "bg-[#0B1E3A] text-white border-transparent shadow-md"
                : "bg-white text-slate-700 border-[hsl(var(--border))] hover:bg-[hsl(var(--secondary))]",
              notObserved && "opacity-40"
            )}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <p className="text-[11px] text-slate-400">1 = Needs work · {Math.ceil(scale / 2)} = Average · {scale} = Elite</p>
        <button
          type="button"
          onClick={() => onChange({ value: null, not_observed: !notObserved })}
          data-testid={`not-observed-${metric.key || metric.id}`}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
            notObserved ? "bg-[#FFF7E6] text-[#B45309] border-[#FFD9A3]" : "bg-white text-slate-400 border-slate-200"
          )}
        >
          <EyeOff className="h-3 w-3" /> Not observed
        </button>
      </div>
    </div>
  );
};

const MeasurementControl = ({ metric, entry, onChange }) => {
  const notObserved = entry?.not_observed;
  return (
    <div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type="number"
            inputMode="decimal"
            step="any"
            disabled={notObserved}
            value={entry?.value ?? ""}
            onChange={(e) => onChange({ ...entry, value: e.target.value === "" ? null : parseFloat(e.target.value), not_observed: false })}
            placeholder="Attempt 1"
            className="h-14 rounded-xl text-lg font-mono-num pr-14 bg-white"
            data-testid={`measurement-${metric.key || metric.id}-input`}
          />
          {metric.unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-medium">{metric.unit}</span>}
        </div>
        <div className="relative flex-1">
          <Input
            type="number"
            inputMode="decimal"
            step="any"
            disabled={notObserved}
            value={entry?.attempt_2 ?? ""}
            onChange={(e) => onChange({ ...entry, attempt_2: e.target.value === "" ? null : parseFloat(e.target.value) })}
            placeholder="Attempt 2 (opt.)"
            className="h-14 rounded-xl text-lg font-mono-num pr-14 bg-white"
            data-testid={`measurement-${metric.key || metric.id}-attempt2`}
          />
          {metric.unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-medium">{metric.unit}</span>}
        </div>
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <p className="text-[11px] text-slate-400">
          {metric.higher_is_better === false ? "Lower is better · best attempt counts" : "Higher is better · best attempt counts"}
        </p>
        <button
          type="button"
          onClick={() => onChange({ value: null, attempt_2: null, not_observed: !notObserved })}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
            notObserved ? "bg-[#FFF7E6] text-[#B45309] border-[#FFD9A3]" : "bg-white text-slate-400 border-slate-200"
          )}
        >
          <EyeOff className="h-3 w-3" /> Not observed
        </button>
      </div>
    </div>
  );
};

const YesNoControl = ({ metric, entry, onChange }) => (
  <div className="grid grid-cols-2 gap-2">
    {[{ label: "Yes", v: true }, { label: "No", v: false }].map(({ label, v }) => (
      <button
        key={label}
        type="button"
        onClick={() => onChange({ value: entry?.value === v ? null : v })}
        className={cn(
          "h-14 rounded-xl border text-base font-bold transition active:scale-[0.97]",
          entry?.value === v ? "bg-[#0B1E3A] text-white border-transparent" : "bg-white text-slate-700 hover:bg-[hsl(var(--secondary))]"
        )}
      >
        {label}
      </button>
    ))}
  </div>
);

export default function EvaluationForm() {
  const { evaluationId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [evaluation, setEvaluation] = useState(null);
  const [scores, setScores] = useState({});
  const [comments, setComments] = useState({ strengths: "", development_needs: "", general: "", quick_tags: [] });
  const [saveStatus, setSaveStatus] = useState("idle");
  const [lastSaved, setLastSaved] = useState(null);
  const [roster, setRoster] = useState([]);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaDesc, setMediaDesc] = useState("");
  const [mediaConsent, setMediaConsent] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const saveTimer = useRef(null);
  const pendingRef = useRef(false);

  const locked = evaluation && ["submitted", "approved"].includes(evaluation.status);
  const template = evaluation?.template;

  // ---------- Load evaluation + restore offline draft ----------
  useEffect(() => {
    let cancelled = false;
    api.get(`/evaluations/${evaluationId}`).then((r) => {
      if (cancelled) return;
      const ev = r.data;
      let s = ev.scores || {};
      let c = ev.comments || { strengths: "", development_needs: "", general: "", quick_tags: [] };
      // restore local draft if newer than server copy
      try {
        const local = JSON.parse(localStorage.getItem(draftKey(evaluationId)) || "null");
        if (local && (!ev.client_updated_at || local.client_updated_at > ev.client_updated_at) && !(["submitted", "approved"].includes(ev.status))) {
          s = local.scores || s;
          c = local.comments || c;
          setSaveStatus("sync_pending");
          toast.info("Restored an unsaved draft from this device. Syncing…");
          setTimeout(() => pushSave(s, c, local.client_updated_at), 400);
        }
      } catch { /* ignore */ }
      setEvaluation(ev);
      setScores(s);
      setComments(c);
      if (ev.assignment_id) {
        api.get(`/my-assignments/${ev.assignment_id}/athletes`).then((rr) => !cancelled && setRoster(rr.data)).catch(() => {});
      }
    }).catch((e) => {
      toast.error(errMsg(e));
      navigate("/evaluate");
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluationId]);

  // ---------- Autosave ----------
  const pushSave = useCallback(async (s, c, clientTs) => {
    if (!navigator.onLine) {
      setSaveStatus("offline");
      pendingRef.current = true;
      return;
    }
    setSaveStatus("saving");
    try {
      await api.put(`/evaluations/${evaluationId}/autosave`, {
        scores: s, comments: c, client_updated_at: clientTs,
      });
      setSaveStatus("saved");
      setLastSaved(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
      pendingRef.current = false;
      localStorage.removeItem(draftKey(evaluationId));
    } catch (e) {
      if (e?.response?.status === 409) {
        setSaveStatus("error");
        toast.error("This evaluation is locked and can no longer be edited.");
      } else if (!navigator.onLine || e.code === "ERR_NETWORK") {
        setSaveStatus("offline");
        pendingRef.current = true;
      } else {
        setSaveStatus("error");
        pendingRef.current = true;
      }
    }
  }, [evaluationId]);

  const queueSave = useCallback((s, c) => {
    const clientTs = new Date().toISOString();
    // always keep a local copy first (offline resilience)
    localStorage.setItem(draftKey(evaluationId), JSON.stringify({ scores: s, comments: c, client_updated_at: clientTs }));
    setSaveStatus((prev) => (prev === "offline" ? "offline" : "saving"));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => pushSave(s, c, clientTs), 650);
  }, [evaluationId, pushSave]);

  // flush pending saves when connection returns
  useEffect(() => {
    const onOnline = () => {
      if (pendingRef.current) {
        try {
          const local = JSON.parse(localStorage.getItem(draftKey(evaluationId)) || "null");
          if (local) {
            setSaveStatus("sync_pending");
            pushSave(local.scores, local.comments, local.client_updated_at);
          }
        } catch { /* ignore */ }
      }
    };
    const onOffline = () => setSaveStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [evaluationId, pushSave]);

  const setMetric = (metricId, entry) => {
    if (locked) return;
    const s = { ...scores, [metricId]: entry };
    setScores(s);
    queueSave(s, comments);
  };

  const setComment = (key, value) => {
    if (locked) return;
    const c = { ...comments, [key]: value };
    setComments(c);
    queueSave(scores, c);
  };

  const toggleTag = (tag) => {
    const tags = comments.quick_tags || [];
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    setComment("quick_tags", next);
  };

  // ---------- Completion / submit ----------
  const scorableMetrics = useMemo(() => (template?.metrics || []).filter((m) => !["comment", "observation"].includes(m.metric_type)), [template]);
  const filledCount = scorableMetrics.filter((m) => {
    const e = scores[m.id];
    return e && (e.not_observed || (e.value !== null && e.value !== undefined && e.value !== ""));
  }).length;
  const completionPct = scorableMetrics.length ? Math.round((filledCount / scorableMetrics.length) * 100) : 0;
  const missingRequired = scorableMetrics.filter((m) => {
    if (!m.required) return false;
    const e = scores[m.id];
    return !(e && (e.not_observed || (e.value !== null && e.value !== undefined && e.value !== "")));
  });

  const submit = async () => {
    setSubmitting(true);
    try {
      await api.post(`/evaluations/${evaluationId}/submit`);
      toast.success("Evaluation submitted and locked.");
      localStorage.removeItem(draftKey(evaluationId));
      setSubmitOpen(false);
      setEvaluation((e) => ({ ...e, status: "submitted" }));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- Media upload ----------
  const uploadMedia = async () => {
    if (!mediaFile || !mediaConsent) return;
    setMediaBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", mediaFile);
      fd.append("athlete_id", evaluation.athlete_id);
      fd.append("event_id", evaluation.event_id);
      fd.append("evaluation_id", evaluationId);
      fd.append("description", mediaDesc);
      fd.append("consent_verified", "true");
      await api.post("/media/upload", fd);
      toast.success("Media uploaded.");
      setMediaOpen(false);
      setMediaFile(null);
      setMediaDesc("");
      setMediaConsent(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setMediaBusy(false);
    }
  };

  // ---------- Prev / Next ----------
  const idx = roster.findIndex((p) => p.athlete_id === evaluation?.athlete_id);
  const goTo = async (offset) => {
    const next = roster[idx + offset];
    if (!next) return;
    if (next.evaluation_id) {
      navigate(`/evaluation/${next.evaluation_id}`);
    } else {
      try {
        const r = await api.post("/evaluations/start", { assignment_id: evaluation.assignment_id, athlete_id: next.athlete_id });
        navigate(`/evaluation/${r.data.id}`);
      } catch (e) {
        toast.error(errMsg(e));
      }
    }
  };

  if (!evaluation)
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-24 rounded-2xl" />
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
      </div>
    );

  const athlete = evaluation.athlete || {};
  const categories = [...new Set((template?.metrics || []).map((m) => m.category))];

  return (
    <div className="max-w-2xl mx-auto -mt-2">
      {/* Sticky top bar */}
      <div className="sticky top-14 lg:top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2.5 bg-[hsl(var(--background))] border-b flex items-center justify-between gap-2">
        <button onClick={() => navigate(`/evaluate/${evaluation.assignment_id}`)} className="inline-flex items-center gap-1 text-sm font-medium text-[#1F4AA8]" data-testid="evaluation-back-button">
          <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Players</span>
        </button>
        <div className="min-w-0 text-center">
          <p className="text-xs font-semibold text-[#0B1E3A] truncate">{evaluation.station_name}</p>
          <p className="text-[10px] text-slate-400 truncate">{evaluation.event_name}</p>
        </div>
        {locked ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF7EF] border border-[#BFE6CC] text-[#14532D] px-2.5 py-1 text-xs font-semibold">
            <Lock className="h-3 w-3" /> {evaluation.status === "approved" ? "Approved" : "Submitted"}
          </span>
        ) : (
          <SaveStatusPill status={saveStatus} lastSaved={lastSaved} />
        )}
      </div>

      {/* Player header */}
      <div className="flex items-center gap-3.5 py-4">
        <PlayerAvatar firstName={athlete.first_name} lastName={athlete.last_name} size="lg" bib={evaluation.bib_number} />
        <div className="flex-1 min-w-0">
          <p className="font-display text-3xl text-[#0B1E3A] leading-none truncate" data-testid="evaluation-player-name">{athlete.first_name} {athlete.last_name}</p>
          <p className="text-sm text-slate-500 mt-1">{athlete.age_group || "—"} · {athlete.primary_position || "—"} · ID {String(athlete.id || "").slice(0, 8).toUpperCase()}</p>
        </div>
        <div className="text-right">
          <p className="font-mono-num font-bold text-2xl text-[#0B1E3A]">{completionPct}%</p>
          <p className="text-[10px] text-slate-400 uppercase tracking-wide">Complete</p>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-[hsl(var(--muted))] overflow-hidden mb-5">
        <div className="h-full bg-[#1F7A4D] rounded-full transition-all duration-300" style={{ width: `${completionPct}%` }} />
      </div>

      {locked && (
        <div className="mb-4 rounded-xl bg-[#EAF7EF] border border-[#BFE6CC] px-4 py-3 text-sm text-[#14532D] flex items-center gap-2">
          <Lock className="h-4 w-4" /> This evaluation is locked. Contact your Head Scout or admin for an authorized revision.
        </div>
      )}
      {evaluation.returned && evaluation.review_note && !locked && (
        <div className="mb-4 rounded-xl bg-[#FDECEC] border border-[#F8B4B4] px-4 py-3 text-sm text-[#7F1D1D]">
          <p className="font-semibold">Returned for revision:</p> {evaluation.review_note}
        </div>
      )}

      {/* Metric sections grouped by category */}
      <div className="space-y-6">
        {categories.map((cat) => (
          <div key={cat}>
            <h2 className="font-display text-xl text-[#0B1E3A] mb-2.5 flex items-center gap-2">
              <span className="h-4 w-1 rounded bg-[#F4B400] inline-block" /> {cat}
            </h2>
            <div className="space-y-4">
              {(template?.metrics || []).filter((m) => m.category === cat).sort((a, b) => (a.display_order || 0) - (b.display_order || 0)).map((m) => (
                <div key={m.id} className="rounded-2xl bg-white border border-[#E7E1D6] p-4 card-shadow">
                  <div className="flex items-center justify-between mb-2.5">
                    <p className="font-semibold text-[#0B1E3A] text-sm">
                      {m.name} {m.required && <span className="text-[#C81D25]">*</span>}
                    </p>
                    {scores[m.id]?.value !== undefined && scores[m.id]?.value !== null && scores[m.id]?.value !== "" && !scores[m.id]?.not_observed && (
                      <CheckCircle2 className="h-4 w-4 text-[#1F7A4D]" />
                    )}
                  </div>
                  {m.description && <p className="text-xs text-slate-400 -mt-1.5 mb-2">{m.description}</p>}
                  <fieldset disabled={locked} className={cn(locked && "opacity-70 pointer-events-none")}>
                    {["rating_5", "rating_10"].includes(m.metric_type) && <RatingControl metric={m} entry={scores[m.id]} onChange={(e) => setMetric(m.id, e)} />}
                    {["numeric", "time", "velocity"].includes(m.metric_type) && <MeasurementControl metric={m} entry={scores[m.id]} onChange={(e) => setMetric(m.id, e)} />}
                    {m.metric_type === "yes_no" && <YesNoControl metric={m} entry={scores[m.id]} onChange={(e) => setMetric(m.id, e)} />}
                    {m.metric_type === "multiple_choice" && (
                      <div className="flex flex-wrap gap-2">
                        {(m.options || []).map((opt) => (
                          <button key={opt} type="button" onClick={() => setMetric(m.id, { value: scores[m.id]?.value === opt ? null : opt })}
                            className={cn("rounded-xl border px-4 h-11 text-sm font-semibold transition",
                              scores[m.id]?.value === opt ? "bg-[#0B1E3A] text-white border-transparent" : "bg-white text-slate-700")}>
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}
                    {["comment", "observation"].includes(m.metric_type) && (
                      <Textarea value={scores[m.id]?.value || ""} onChange={(e) => setMetric(m.id, { value: e.target.value })} rows={2} className="rounded-xl bg-white" placeholder="Notes…" />
                    )}
                  </fieldset>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Comments */}
        <div>
          <h2 className="font-display text-xl text-[#0B1E3A] mb-2.5 flex items-center gap-2">
            <span className="h-4 w-1 rounded bg-[#C81D25] inline-block" /> Comments
          </h2>
          <div className="rounded-2xl bg-white border border-[#E7E1D6] p-4 card-shadow space-y-4">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Quick tags</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_TAGS.map((tag) => (
                  <button key={tag} type="button" disabled={locked} onClick={() => toggleTag(tag)}
                    data-testid={`quick-tag-${tag.toLowerCase().replace(/\s+/g, "-")}`}
                    className={cn("rounded-full border px-3.5 py-2 text-xs font-semibold transition active:scale-[0.96]",
                      (comments.quick_tags || []).includes(tag) ? "bg-[#0B1E3A] text-white border-transparent" : "bg-white text-slate-600 hover:bg-[hsl(var(--secondary))]")}>
                    {tag}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Strengths</p>
              <Textarea disabled={locked} value={comments.strengths} onChange={(e) => setComment("strengths", e.target.value)} rows={2} className="rounded-xl" placeholder="What stood out…" data-testid="comments-strengths-textarea" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Development needs</p>
              <Textarea disabled={locked} value={comments.development_needs} onChange={(e) => setComment("development_needs", e.target.value)} rows={2} className="rounded-xl" placeholder="Areas to work on…" data-testid="comments-needs-textarea" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">General comment</p>
              <Textarea disabled={locked} value={comments.general} onChange={(e) => setComment("general", e.target.value)} rows={2} className="rounded-xl" placeholder="Anything else…" data-testid="comments-general-textarea" />
            </div>
            <Button variant="outline" className="rounded-xl h-11" onClick={() => setMediaOpen(true)} disabled={locked} data-testid="add-media-button">
              <Camera className="h-4 w-4 mr-1.5" /> Add Photo / Video
            </Button>
          </div>
        </div>
      </div>

      {/* Sticky footer nav */}
      <div className="sticky bottom-[76px] lg:bottom-0 z-30 -mx-4 sm:-mx-6 mt-6 px-4 sm:px-6 py-3 bg-white border-t sticky-bar-shadow flex items-center gap-2">
        <Button variant="outline" className="rounded-xl h-12 px-3" disabled={idx <= 0} onClick={() => goTo(-1)} data-testid="prev-player-button">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        {!locked ? (
          <Button className="flex-1 rounded-xl h-12 bg-[#0B1E3A] hover:bg-[#102A4F] text-base font-semibold active:scale-[0.98]" onClick={() => setSubmitOpen(true)} data-testid="evaluation-submit-button">
            <Send className="h-4 w-4 mr-1.5" /> Submit Evaluation
          </Button>
        ) : (
          <Button variant="outline" className="flex-1 rounded-xl h-12" onClick={() => navigate(`/evaluate/${evaluation.assignment_id}`)}>
            Back to Player List
          </Button>
        )}
        <Button variant="outline" className="rounded-xl h-12 px-3" disabled={idx < 0 || idx >= roster.length - 1} onClick={() => goTo(1)} data-testid="next-player-button">
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {/* Pre-submit dialog */}
      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent className="rounded-2xl max-w-sm" data-testid="evaluation-submit-checklist">
          <DialogHeader><DialogTitle className="font-display text-2xl text-[#0B1E3A]">Ready to submit?</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-xl bg-[hsl(var(--secondary))] px-3.5 py-2.5">
              <span>Metrics completed</span>
              <span className="font-mono-num font-bold">{filledCount}/{scorableMetrics.length} ({completionPct}%)</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-[hsl(var(--secondary))] px-3.5 py-2.5">
              <span>Comments</span>
              <span className="font-semibold">{comments.strengths || comments.development_needs || comments.general ? "Added" : "None"}</span>
            </div>
            {missingRequired.length > 0 && (
              <div className="rounded-xl bg-[#FDECEC] border border-[#F8B4B4] px-3.5 py-2.5 text-[#7F1D1D]">
                <p className="font-semibold mb-1">Missing required metrics:</p>
                <ul className="list-disc pl-4 space-y-0.5">{missingRequired.map((m) => <li key={m.id}>{m.name}</li>)}</ul>
              </div>
            )}
            <p className="text-xs text-slate-500 pt-1">After submitting, this evaluation is locked and sent to the Head Scout for review.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setSubmitOpen(false)}>Keep editing</Button>
            <Button className="rounded-xl bg-[#0B1E3A] hover:bg-[#102A4F]" disabled={submitting || missingRequired.length > 0} onClick={submit} data-testid="confirm-submit-button">
              {submitting ? "Submitting…" : "Submit & Lock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Media dialog */}
      <Dialog open={mediaOpen} onOpenChange={setMediaOpen}>
        <DialogContent className="rounded-2xl max-w-sm">
          <DialogHeader><DialogTitle className="font-display text-2xl text-[#0B1E3A]">Add Media</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input type="file" accept="image/*,video/*" onChange={(e) => setMediaFile(e.target.files?.[0] || null)} className="rounded-xl h-11 pt-2" data-testid="media-file-input" />
            <Textarea value={mediaDesc} onChange={(e) => setMediaDesc(e.target.value)} rows={2} placeholder="Description (optional)" className="rounded-xl" />
            <label className="flex items-start gap-2 text-xs text-slate-600">
              <Checkbox checked={mediaConsent} onCheckedChange={setMediaConsent} data-testid="media-consent-checkbox" className="mt-0.5" />
              I confirm media consent has been verified for this athlete (required for minors).
            </label>
          </div>
          <DialogFooter>
            <Button className="w-full rounded-xl bg-[#0B1E3A] hover:bg-[#102A4F] h-11" disabled={!mediaFile || !mediaConsent || mediaBusy} onClick={uploadMedia} data-testid="media-upload-button">
              {mediaBusy ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
