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
import { POSITIONS, loadStationTemplates, resolveTemplateLocal, saveStationTemplates } from "@/lib/templateCache";

const QUICK_TAGS = ["Hustle", "Great attitude", "Quick hands", "Strong arm", "Needs reps", "High motor", "Raw but projectable", "Team leader"];

const draftKey = (id) => `pbg_draft_${id}`;
const templateDraftKey = (id) => `pbg_eval_template_${id}`;
const metaDraftKey = (id) => `pbg_eval_meta_${id}`;

const NotObservedBtn = ({ notObserved, onToggle, testId }) => (
  <button
    type="button"
    onClick={onToggle}
    data-testid={testId}
    className={cn(
      "w-full mt-2 inline-flex items-center justify-center gap-1.5 rounded-xl border h-11 text-xs font-semibold transition active:scale-[0.98]",
      notObserved ? "bg-warning/15 text-warning border-warning/40" : "bg-secondary text-muted-foreground border-border"
    )}
  >
    <EyeOff className="h-3.5 w-3.5" /> {notObserved ? "Marked not observed — tap to undo" : "Not observed"}
  </button>
);

const RatingControl = ({ metric, entry, onChange }) => {
  const value = entry?.value;
  const notObserved = entry?.not_observed;
  const scale = metric.metric_type === "rating_10" ? 10 : 5;
  const values = Array.from({ length: scale }, (_, i) => i + 1);
  return (
    <div>
      {scale === 10 ? (
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-0.5 px-0.5 snap-x">
          {values.map((v) => (
            <button
              key={v}
              type="button"
              disabled={notObserved}
              onClick={() => onChange({ ...entry, value: entry?.value === v ? null : v, not_observed: false })}
              data-testid={`rating-${metric.key || metric.id}-toggle-${v}`}
              className={cn(
                "h-14 min-w-[44px] shrink-0 snap-start rounded-xl border text-lg font-bold transition-all duration-150 active:scale-[0.96]",
                value === v
                  ? "bg-primary text-white border-transparent"
                  : "bg-card text-foreground border-border hover:bg-secondary",
                notObserved && "opacity-40"
              )}
            >
              {v}
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-1.5">
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
                  ? "bg-primary text-white border-transparent"
                  : "bg-card text-foreground border-border hover:bg-secondary",
                notObserved && "opacity-40"
              )}
            >
              {v}
            </button>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground mt-1.5">1 = Needs work · {Math.ceil(scale / 2)} = Average · {scale} = Elite</p>
      <NotObservedBtn
        notObserved={notObserved}
        testId={`not-observed-${metric.key || metric.id}`}
        onToggle={() => onChange({ value: null, not_observed: !notObserved })}
      />
    </div>
  );
};

const MeasurementControl = ({ metric, entry, onChange }) => {
  const notObserved = entry?.not_observed;
  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Input
            type="number"
            inputMode="decimal"
            step="any"
            disabled={notObserved}
            value={entry?.value ?? ""}
            onChange={(e) => onChange({ ...entry, value: e.target.value === "" ? null : parseFloat(e.target.value), not_observed: false })}
            placeholder="Attempt 1"
            className="h-14 rounded-xl text-lg font-mono-num pr-14 bg-card"
            data-testid={`measurement-${metric.key || metric.id}-input`}
          />
          {metric.unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">{metric.unit}</span>}
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
            className="h-14 rounded-xl text-lg font-mono-num pr-14 bg-card"
            data-testid={`measurement-${metric.key || metric.id}-attempt2`}
          />
          {metric.unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">{metric.unit}</span>}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mt-1.5">
        {metric.higher_is_better === false ? "Lower is better · best attempt counts" : "Higher is better · best attempt counts"}
      </p>
      <NotObservedBtn
        notObserved={notObserved}
        onToggle={() => onChange({ value: null, attempt_2: null, not_observed: !notObserved })}
      />
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
          entry?.value === v ? "bg-primary text-white border-transparent" : "bg-card text-foreground hover:bg-secondary"
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
  const [evaluateAs, setEvaluateAs] = useState("");
  const [resolutionReason, setResolutionReason] = useState(null);
  const [overrideBusy, setOverrideBusy] = useState(false);
  const saveTimer = useRef(null);
  const pendingRef = useRef(false);
  const retryTimer = useRef(null);
  const retryAttempt = useRef(0);
  const inflightRef = useRef(false);

  const locked = evaluation && ["submitted", "approved"].includes(evaluation.status);
  // Prefer persisted evaluation template; fall back to locally cached station pack (offline)
  const template = useMemo(() => {
    if (evaluation?.template) return evaluation.template;
    try {
      const cached = JSON.parse(localStorage.getItem(templateDraftKey(evaluationId)) || "null");
      if (cached) return cached;
    } catch { /* ignore */ }
    if (evaluation?.event_id && evaluation?.station_id) {
      const pack = loadStationTemplates(evaluation.event_id, evaluation.station_id);
      if (pack?.templates) {
        const pos = evaluateAs || evaluation?.evaluated_as_position || evaluation?.athlete?.primary_position;
        const { template: t } = resolveTemplateLocal(pack.templates, {
          position: pos,
          stationTemplateId: pack.station_template_id || evaluation.station_template_id,
        });
        return t;
      }
    }
    return null;
  }, [evaluation, evaluationId, evaluateAs]);

  // ---------- Autosave (defined before load effect so restore can flush) ----------
  const pushSave = useCallback(async (s, c, clientTs) => {
    if (!navigator.onLine) {
      setSaveStatus("offline");
      pendingRef.current = true;
      return;
    }
    if (inflightRef.current) {
      pendingRef.current = true;
      return;
    }
    inflightRef.current = true;
    setSaveStatus("saving");
    try {
      const r = await api.put(`/evaluations/${evaluationId}/autosave`, {
        scores: s, comments: c, client_updated_at: clientTs,
      });
      const status = r?.data?.status;
      if (status === "stale_ignored") {
        // Server already has a newer copy — re-pull so we don't wipe local clarity wrongly
        pendingRef.current = false;
        retryAttempt.current = 0;
        try {
          const fresh = await api.get(`/evaluations/${evaluationId}`);
          const ev = fresh.data;
          setEvaluation(ev);
          setScores(ev.scores || {});
          setComments(ev.comments || { strengths: "", development_needs: "", general: "", quick_tags: [] });
          localStorage.removeItem(draftKey(evaluationId));
          setSaveStatus("saved");
          setLastSaved(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
          toast.info("Loaded a newer save from the server.");
        } catch {
          setSaveStatus("error");
          pendingRef.current = true;
        }
        return;
      }
      // Only clear the local draft after an explicit server save ack
      if (status === "saved" || !status) {
        setSaveStatus("saved");
        setLastSaved(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
        pendingRef.current = false;
        retryAttempt.current = 0;
        localStorage.removeItem(draftKey(evaluationId));
      } else {
        // Unknown status — keep draft, surface error
        setSaveStatus("error");
        pendingRef.current = true;
      }
    } catch (e) {
      if (e?.response?.status === 409) {
        setSaveStatus("error");
        toast.error("This evaluation is locked and can no longer be edited.");
        localStorage.removeItem(draftKey(evaluationId));
      } else if (!navigator.onLine || e.code === "ERR_NETWORK") {
        setSaveStatus("offline");
        pendingRef.current = true;
      } else {
        setSaveStatus("error");
        pendingRef.current = true;
        // exponential backoff retry for flaky cell (venue wifi)
        const attempt = retryAttempt.current + 1;
        retryAttempt.current = attempt;
        if (attempt <= 4) {
          const delay = Math.min(8000, 500 * (2 ** (attempt - 1)));
          if (retryTimer.current) clearTimeout(retryTimer.current);
          retryTimer.current = setTimeout(() => {
            try {
              const local = JSON.parse(localStorage.getItem(draftKey(evaluationId)) || "null");
              if (local) pushSave(local.scores, local.comments, local.client_updated_at);
            } catch { /* ignore */ }
          }, delay);
        }
      }
    } finally {
      inflightRef.current = false;
      // If edits queued while we were saving, flush the latest local draft
      if (pendingRef.current && navigator.onLine) {
        try {
          const local = JSON.parse(localStorage.getItem(draftKey(evaluationId)) || "null");
          if (local) {
            setSaveStatus("sync_pending");
            setTimeout(() => pushSave(local.scores, local.comments, local.client_updated_at), 50);
          }
        } catch { /* ignore */ }
      }
    }
  }, [evaluationId]);

  const queueSave = useCallback((s, c) => {
    const clientTs = new Date().toISOString();
    // always keep a local copy first (offline resilience)
    localStorage.setItem(draftKey(evaluationId), JSON.stringify({ scores: s, comments: c, client_updated_at: clientTs }));
    pendingRef.current = true;
    setSaveStatus((prev) => (prev === "offline" ? "offline" : "saving"));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => pushSave(s, c, clientTs), 650);
  }, [evaluationId, pushSave]);

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
      setEvaluateAs(ev.evaluated_as_position || "");
      setResolutionReason(ev.template_resolution_reason || null);
      // Persist template + athlete snapshot so offline form still shows who you're scoring
      try {
        if (ev.template) localStorage.setItem(templateDraftKey(evaluationId), JSON.stringify(ev.template));
        localStorage.setItem(metaDraftKey(evaluationId), JSON.stringify({
          athlete: ev.athlete,
          bib_number: ev.bib_number,
          station_name: ev.station_name,
          event_name: ev.event_name,
          assignment_id: ev.assignment_id,
          athlete_id: ev.athlete_id,
          event_id: ev.event_id,
          station_id: ev.station_id,
          resolved_position: ev.resolved_position,
          evaluated_as_position: ev.evaluated_as_position,
        }));
      } catch { /* ignore */ }
      // Ensure station template pack is warm
      if (ev.event_id && ev.station_id && !loadStationTemplates(ev.event_id, ev.station_id)) {
        api.get("/evaluations/templates-for-station", {
          params: { event_id: ev.event_id, station_id: ev.station_id },
        }).then((pack) => {
          saveStationTemplates(ev.event_id, ev.station_id, pack.data);
        }).catch(() => {});
      }
      if (ev.assignment_id) {
        api.get(`/my-assignments/${ev.assignment_id}/athletes`).then((rr) => !cancelled && setRoster(rr.data)).catch(() => {});
      }
    }).catch((e) => {
      // Offline: try to keep working from local draft + cached template
      try {
        const local = JSON.parse(localStorage.getItem(draftKey(evaluationId)) || "null");
        const tmpl = JSON.parse(localStorage.getItem(templateDraftKey(evaluationId)) || "null");
        const meta = JSON.parse(localStorage.getItem(metaDraftKey(evaluationId)) || "null") || {};
        if (local || tmpl) {
          setEvaluation({
            id: evaluationId,
            status: "draft",
            scores: local?.scores || {},
            comments: local?.comments || { strengths: "", development_needs: "", general: "", quick_tags: [] },
            template: tmpl,
            athlete: meta.athlete || {},
            bib_number: meta.bib_number,
            station_name: meta.station_name || "Offline",
            event_name: meta.event_name || "Offline",
            assignment_id: meta.assignment_id,
            athlete_id: meta.athlete_id,
            event_id: meta.event_id,
            station_id: meta.station_id,
            resolved_position: meta.resolved_position,
            evaluated_as_position: meta.evaluated_as_position,
          });
          if (local) {
            setScores(local.scores || {});
            setComments(local.comments || { strengths: "", development_needs: "", general: "", quick_tags: [] });
          }
          setSaveStatus("offline");
          toast.info("Working offline from cached evaluation.");
          return;
        }
      } catch { /* ignore */ }
      toast.error(errMsg(e));
      navigate("/evaluate");
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluationId]);

  const applyPositionOverride = async (pos) => {
    if (locked) return;
    setEvaluateAs(pos);
    setOverrideBusy(true);
    try {
      const clientTs = new Date().toISOString();
      // Keep draft first
      localStorage.setItem(draftKey(evaluationId), JSON.stringify({
        scores, comments, client_updated_at: clientTs, evaluated_as_position: pos || null,
      }));
      if (!navigator.onLine) {
        // Resolve from offline cache
        const pack = loadStationTemplates(evaluation.event_id, evaluation.station_id);
        if (pack?.templates) {
          const { template: t, reason } = resolveTemplateLocal(pack.templates, {
            position: pos || evaluation.athlete?.primary_position,
            stationTemplateId: pack.station_template_id || evaluation.station_template_id,
          });
          if (!t) {
            toast.error("No template available offline for that position.");
            return;
          }
          setEvaluation((ev) => ({ ...ev, template: t, evaluated_as_position: pos || null, resolved_position: pos || ev.athlete?.primary_position }));
          setResolutionReason(reason);
          try { localStorage.setItem(templateDraftKey(evaluationId), JSON.stringify(t)); } catch { /* ignore */ }
          setSaveStatus("offline");
          pendingRef.current = true;
        }
        return;
      }
      const r = await api.put(`/evaluations/${evaluationId}/autosave`, {
        scores, comments, client_updated_at: clientTs, evaluated_as_position: pos,
      });
      // Re-fetch to get re-resolved template
      const fresh = await api.get(`/evaluations/${evaluationId}`);
      setEvaluation(fresh.data);
      setResolutionReason(fresh.data.template_resolution_reason || null);
      if (fresh.data.template) {
        try { localStorage.setItem(templateDraftKey(evaluationId), JSON.stringify(fresh.data.template)); } catch { /* ignore */ }
      }
      setSaveStatus("saved");
      if (r?.data?.status === "saved") localStorage.removeItem(draftKey(evaluationId));
      toast.success(pos ? `Evaluating as ${pos}` : "Using registered position");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setOverrideBusy(false);
    }
  };
  // flush pending saves when connection returns
  useEffect(() => {
    const onOnline = () => {
      try {
        const local = JSON.parse(localStorage.getItem(draftKey(evaluationId)) || "null");
        if (local || pendingRef.current) {
          setSaveStatus("sync_pending");
          if (local) pushSave(local.scores, local.comments, local.client_updated_at);
        }
      } catch { /* ignore */ }
    };
    const onOffline = () => setSaveStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if (retryTimer.current) clearTimeout(retryTimer.current);
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

  const flushDraft = async () => {
    try {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const local = JSON.parse(localStorage.getItem(draftKey(evaluationId)) || "null");
      if (!local && !pendingRef.current) return true;
      if (!navigator.onLine) {
        setSaveStatus("offline");
        return false;
      }
      setSaveStatus("sync_pending");
      if (local) await pushSave(local.scores, local.comments, local.client_updated_at);
      return !(pendingRef.current || localStorage.getItem(draftKey(evaluationId)));
    } catch {
      return false;
    }
  };

  const retrySync = () => {
    try {
      const local = JSON.parse(localStorage.getItem(draftKey(evaluationId)) || "null");
      if (local) {
        setSaveStatus("sync_pending");
        pushSave(local.scores, local.comments, local.client_updated_at);
      }
    } catch { /* ignore */ }
  };

  const submit = async () => {
    const synced = await flushDraft();
    if (!synced) {
      toast.error(navigator.onLine
        ? "Scores are still syncing. Try again in a moment."
        : "You're offline. Reconnect and wait for sync before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/evaluations/${evaluationId}/submit`);
      toast.success("Evaluation submitted and locked.");
      localStorage.removeItem(draftKey(evaluationId));
      setSubmitOpen(false);
      setEvaluation((e) => ({ ...e, status: "submitted" }));
      // Auto-advance to next incomplete on the station roster
      const curIdx = roster.findIndex((p) => p.athlete_id === evaluation?.athlete_id);
      const nextIncomplete = roster.find((p, i) => i > curIdx && !["submitted", "approved"].includes(p.evaluation_status))
        || roster.find((p) => p.athlete_id !== evaluation?.athlete_id && !["submitted", "approved"].includes(p.evaluation_status));
      if (nextIncomplete) {
        setTimeout(() => goToPlayer(nextIncomplete), 400);
      }
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
  const prevPlayer = idx > 0 ? roster[idx - 1] : null;
  const nextPlayer = idx >= 0 && idx < roster.length - 1 ? roster[idx + 1] : null;

  const goToPlayer = async (next) => {
    if (!next) return;
    if (!locked) {
      const ok = await flushDraft();
      if (!ok && navigator.onLine) {
        toast.error("Still syncing scores — wait a second, then try again.");
        return;
      }
      if (!ok && !navigator.onLine) {
        toast.message("Saved on this device. Opening next player…");
      }
    }
    if (next.evaluation_id) {
      navigate(`/evaluation/${next.evaluation_id}`);
      return;
    }
    if (!navigator.onLine) {
      toast.error("Offline — can't start a new player. Finish open drafts or reconnect.");
      return;
    }
    try {
      const r = await api.post("/evaluations/start", { assignment_id: evaluation.assignment_id, athlete_id: next.athlete_id });
      navigate(`/evaluation/${r.data.id}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const goTo = (offset) => {
    const next = roster[idx + offset];
    if (next) goToPlayer(next);
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
      {/* Sticky chrome — athlete identity always visible while scrolling metrics */}
      <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2.5 bg-background/95 border-b border-divider" data-testid="evaluation-sticky-header">
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => navigate(`/evaluate/${evaluation.assignment_id}`)} className="inline-flex items-center gap-1 text-sm font-medium text-info min-h-[40px] shrink-0" data-testid="evaluation-back-button">
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">List</span>
          </button>
          <div className="min-w-0 flex-1 text-center px-1">
            <p className="font-semibold text-sm text-foreground truncate" data-testid="evaluation-player-name">
              {evaluation.bib_number ? `#${evaluation.bib_number} · ` : ""}
              {athlete.last_name || "—"}{athlete.first_name ? `, ${athlete.first_name}` : ""}
            </p>
            <p className="text-[10px] text-muted-foreground truncate">
              {evaluateAs || evaluation.resolved_position || athlete.primary_position || "POS?"}
              {" · "}{athlete.age_group || "—"}
              {" · "}{evaluation.station_name}
              {missingRequired.length > 0 ? ` · ${missingRequired.length} required left` : ""}
            </p>
          </div>
          {locked ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 border border-success/40 text-success px-2.5 py-1 text-xs font-semibold shrink-0">
              <Lock className="h-3 w-3" /> Locked
            </span>
          ) : (
            <SaveStatusPill status={saveStatus} lastSaved={lastSaved} onRetry={retrySync} />
          )}
        </div>
        <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-300", missingRequired.length ? "bg-warning" : "bg-success")}
            style={{ width: `${completionPct}%` }}
          />
        </div>
      </div>

      <div className="flex items-center gap-3.5 py-3">
        <PlayerAvatar firstName={athlete.first_name} lastName={athlete.last_name} size="lg" bib={evaluation.bib_number} />
        <div className="flex-1 min-w-0">
          <p className="font-display text-2xl sm:text-3xl text-foreground leading-none truncate">
            {athlete.first_name} {athlete.last_name}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <span
              className="inline-flex items-center rounded-full bg-brand text-primary-foreground px-2.5 py-0.5 text-[11px] font-bold tracking-wide"
              data-testid="resolved-position-badge"
            >
              {evaluateAs || evaluation.resolved_position || athlete.primary_position || "POS?"}
            </span>
            {resolutionReason && (
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide" data-testid="resolution-reason">
                via {resolutionReason.replace(/_/g, " ")}
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="font-mono-num font-bold text-2xl text-foreground">{completionPct}%</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
            {missingRequired.length ? `${missingRequired.length} req` : "Complete"}
          </p>
        </div>
      </div>

      {!locked && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide" htmlFor="evaluate-as">Evaluate as</label>
          <select
            id="evaluate-as"
            disabled={overrideBusy}
            value={evaluateAs}
            onChange={(e) => {
              const v = e.target.value;
              if (filledCount > 0 && v !== (evaluateAs || "")) {
                if (!window.confirm("Changing position may swap the metric set. Continue?")) {
                  e.target.value = evaluateAs;
                  return;
                }
              }
              applyPositionOverride(v);
            }}
            className="h-12 rounded-xl border border-input bg-background px-3 text-sm font-semibold min-w-[8rem]"
            data-testid="evaluate-as-select"
          >
            <option value="">Registered ({athlete.primary_position || "—"})</option>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <span className="text-[11px] text-muted-foreground">This evaluation only — not their registered position.</span>
        </div>
      )}

      {!template && (
        <div className="mb-4 rounded-xl bg-destructive/15 border border-destructive/40 px-4 py-3 text-sm text-destructive" data-testid="missing-template-error">
          No evaluation template could be resolved for this athlete&apos;s position. Contact an admin — do not score a blank form.
        </div>
      )}

      {locked && (
        <div className="mb-4 rounded-xl bg-success/15 border border-success/40 px-4 py-3 text-sm text-success flex items-center gap-2">
          <Lock className="h-4 w-4" /> This evaluation is locked. Contact your Head Scout or admin for an authorized revision.
        </div>
      )}
      {evaluation.returned && evaluation.review_note && !locked && (
        <div className="mb-4 rounded-xl bg-destructive/15 border border-destructive/40 px-4 py-3 text-sm text-destructive">
          <p className="font-semibold">Returned for revision:</p> {evaluation.review_note}
        </div>
      )}

      {/* Metric sections grouped by category */}
      <div className="space-y-6">
        {categories.map((cat) => (
          <div key={cat}>
            <h2 className="font-display text-xl text-foreground mb-2.5 flex items-center gap-2">
              <span className="h-4 w-1 rounded bg-warning inline-block" /> {cat}
            </h2>
            <div className="space-y-4">
              {(template?.metrics || []).filter((m) => m.category === cat).sort((a, b) => (a.display_order || 0) - (b.display_order || 0)).map((m) => (
                <div key={m.id} className="rounded-2xl bg-card border border-border p-4">
                  <div className="flex items-center justify-between mb-2.5">
                    <p className="font-semibold text-foreground text-sm">
                      {m.name} {m.required && <span className="text-destructive">*</span>}
                    </p>
                    {scores[m.id]?.value !== undefined && scores[m.id]?.value !== null && scores[m.id]?.value !== "" && !scores[m.id]?.not_observed && (
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    )}
                  </div>
                  {m.description && <p className="text-xs text-muted-foreground -mt-1.5 mb-2">{m.description}</p>}
                  <fieldset disabled={locked} className={cn(locked && "opacity-70 pointer-events-none")}>
                    {["rating_5", "rating_10"].includes(m.metric_type) && <RatingControl metric={m} entry={scores[m.id]} onChange={(e) => setMetric(m.id, e)} />}
                    {["numeric", "time", "velocity"].includes(m.metric_type) && <MeasurementControl metric={m} entry={scores[m.id]} onChange={(e) => setMetric(m.id, e)} />}
                    {m.metric_type === "yes_no" && <YesNoControl metric={m} entry={scores[m.id]} onChange={(e) => setMetric(m.id, e)} />}
                    {m.metric_type === "multiple_choice" && (
                      <div className="flex flex-wrap gap-2">
                        {(m.options || []).map((opt) => (
                          <button key={opt} type="button" onClick={() => setMetric(m.id, { value: scores[m.id]?.value === opt ? null : opt })}
                            className={cn("rounded-xl border px-4 h-11 text-sm font-semibold transition",
                              scores[m.id]?.value === opt ? "bg-primary text-white border-transparent" : "bg-card text-foreground")}>
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}
                    {["comment", "observation"].includes(m.metric_type) && (
                      <Textarea value={scores[m.id]?.value || ""} onChange={(e) => setMetric(m.id, { value: e.target.value })} rows={2} className="rounded-xl bg-card" placeholder="Notes…" />
                    )}
                  </fieldset>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Comments */}
        <div>
          <h2 className="font-display text-xl text-foreground mb-2.5 flex items-center gap-2">
            <span className="h-4 w-1 rounded bg-destructive inline-block" /> Comments
          </h2>
          <div className="rounded-2xl bg-card border border-border p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Quick tags</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_TAGS.map((tag) => (
                  <button key={tag} type="button" disabled={locked} onClick={() => toggleTag(tag)}
                    data-testid={`quick-tag-${tag.toLowerCase().replace(/\s+/g, "-")}`}
                    className={cn("rounded-full border px-3.5 py-2 text-xs font-semibold transition active:scale-[0.96]",
                      (comments.quick_tags || []).includes(tag) ? "bg-primary text-white border-transparent" : "bg-card text-muted-foreground hover:bg-secondary")}>
                    {tag}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Strengths</p>
              <Textarea disabled={locked} value={comments.strengths} onChange={(e) => setComment("strengths", e.target.value)} rows={2} className="rounded-xl" placeholder="What stood out…" data-testid="comments-strengths-textarea" />
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Development needs</p>
              <Textarea disabled={locked} value={comments.development_needs} onChange={(e) => setComment("development_needs", e.target.value)} rows={2} className="rounded-xl" placeholder="Areas to work on…" data-testid="comments-needs-textarea" />
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">General comment</p>
              <Textarea disabled={locked} value={comments.general} onChange={(e) => setComment("general", e.target.value)} rows={2} className="rounded-xl" placeholder="Anything else…" data-testid="comments-general-textarea" />
            </div>
            <Button variant="outline" className="rounded-xl h-11" onClick={() => setMediaOpen(true)} disabled={locked} data-testid="add-media-button">
              <Camera className="h-4 w-4 mr-1.5" /> Add Photo / Video
            </Button>
          </div>
        </div>
      </div>

      {/* Sticky footer — sits above bottom nav only when nav is visible; evaluation route hides tabs */}
      <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 mt-6 px-4 sm:px-6 py-3 bg-card border-t safe-bottom-pad">
        <div className="flex items-center gap-2">
          <Button variant="outline" className="rounded-xl h-12 px-3" disabled={!prevPlayer} onClick={() => goTo(-1)} data-testid="prev-player-button" title={prevPlayer ? `${prevPlayer.first_name} ${prevPlayer.last_name}` : ""}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          {!locked ? (
            <Button className="flex-1 rounded-xl h-12 bg-brand hover:bg-brand-secondary text-base font-semibold active:scale-[0.98]" onClick={() => setSubmitOpen(true)} data-testid="evaluation-submit-button">
              <Send className="h-4 w-4 mr-1.5" /> Submit
            </Button>
          ) : (
            <Button className="flex-1 rounded-xl h-12 bg-brand hover:bg-brand-secondary" onClick={() => nextPlayer ? goTo(1) : navigate(`/evaluate/${evaluation.assignment_id}`)} data-testid="post-submit-next">
              {nextPlayer ? `Next: ${nextPlayer.first_name}` : "Back to list"}
            </Button>
          )}
          <Button variant="outline" className="rounded-xl h-12 px-3" disabled={!nextPlayer} onClick={() => goTo(1)} data-testid="next-player-button" title={nextPlayer ? `${nextPlayer.first_name} ${nextPlayer.last_name}` : ""}>
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
        {nextPlayer && (
          <p className="text-[11px] text-center text-muted-foreground mt-1.5 truncate">
            Next up · #{nextPlayer.bib_number || "—"} {nextPlayer.first_name} {nextPlayer.last_name}
          </p>
        )}
      </div>

      {/* Pre-submit dialog */}
      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent className="rounded-2xl max-w-sm" data-testid="evaluation-submit-checklist">
          <DialogHeader><DialogTitle className="font-display text-2xl text-foreground">Ready to submit?</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-xl bg-secondary px-3.5 py-2.5">
              <span>Metrics completed</span>
              <span className="font-mono-num font-bold">{filledCount}/{scorableMetrics.length} ({completionPct}%)</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-secondary px-3.5 py-2.5">
              <span>Comments</span>
              <span className="font-semibold">{comments.strengths || comments.development_needs || comments.general ? "Added" : "None"}</span>
            </div>
            {missingRequired.length > 0 && (
              <div className="rounded-xl bg-destructive/15 border border-destructive/40 px-3.5 py-2.5 text-destructive">
                <p className="font-semibold mb-1">Missing required metrics:</p>
                <ul className="list-disc pl-4 space-y-0.5">{missingRequired.map((m) => <li key={m.id}>{m.name}</li>)}</ul>
              </div>
            )}
            <p className="text-xs text-muted-foreground pt-1">After submitting, this evaluation is locked and sent to the Head Scout for review.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setSubmitOpen(false)}>Keep editing</Button>
            <Button
              className="rounded-xl bg-primary hover:bg-brand-secondary"
              disabled={submitting || missingRequired.length > 0 || ["saving", "sync_pending", "offline"].includes(saveStatus)}
              onClick={submit}
              data-testid="confirm-submit-button"
            >
              {submitting ? "Submitting…" : ["saving", "sync_pending"].includes(saveStatus) ? "Syncing…" : saveStatus === "offline" ? "Offline — can't submit" : "Submit & Lock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Media dialog */}
      <Dialog open={mediaOpen} onOpenChange={setMediaOpen}>
        <DialogContent className="rounded-2xl max-w-sm">
          <DialogHeader><DialogTitle className="font-display text-2xl text-foreground">Add Media</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input type="file" accept="image/*,video/*" onChange={(e) => setMediaFile(e.target.files?.[0] || null)} className="rounded-xl h-11 pt-2" data-testid="media-file-input" />
            <Textarea value={mediaDesc} onChange={(e) => setMediaDesc(e.target.value)} rows={2} placeholder="Description (optional)" className="rounded-xl" />
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <Checkbox checked={mediaConsent} onCheckedChange={setMediaConsent} data-testid="media-consent-checkbox" className="mt-0.5" />
              I confirm media consent has been verified for this athlete (required for minors).
            </label>
          </div>
          <DialogFooter>
            <Button className="w-full rounded-xl bg-primary hover:bg-brand-secondary h-11" disabled={!mediaFile || !mediaConsent || mediaBusy} onClick={uploadMedia} data-testid="media-upload-button">
              {mediaBusy ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
