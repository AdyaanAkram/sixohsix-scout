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
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, EyeOff, Camera, CheckCircle2, Lock, MessageSquarePlus, Send, CloudUpload, RotateCcw, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  POSITIONS, loadStationTemplates, resolveTemplateLocal, saveStationTemplates,
  templateDraftKey, metaDraftKey,
  saveDraft, readDraftLocal, loadDraftBest, deleteDraft, saveEvalSnapshot,
  queueMedia, listQueuedMedia, deleteQueuedMedia, countQueuedMedia,
  registerAppShell, MEDIA_MAX_BYTES, MEDIA_WARN_BYTES, MEDIA_ALLOWED_EXT, mediaExtOf,
} from "@/lib/templateCache";

const QUICK_TAGS = ["Hustle", "Great attitude", "Quick hands", "Strong arm", "Needs reps", "High motor", "Raw but projectable", "Team leader"];

// Spec §11 media categories.
const MEDIA_CATEGORIES = ["Profile photo", "Hitting", "Pitching", "Defense", "Running", "Other"];

// Spec §9 — only show categories/metrics that apply to the player.
//
// The evaluation TEMPLATE is already position-resolved on the server (an
// infielder gets the infield template, a catcher the catching template, a
// pitcher the pitching template…), and the per-category / per-metric schema
// carries NO `positions` / `applies_to_positions` field to key off (verified in
// backend/routes_evaluations.py MetricBody & CategoryBody). So rather than
// invent scoring behavior, we treat a category as "position-specific" only when
// its NAME clearly names a fielding discipline, and hide it unless one of the
// athlete's positions qualifies. Universal tool categories (Athleticism,
// Hitting, Defense, Arm Strength, Baseball IQ, Coachability, Comments…) are
// never hidden. Evaluators override with the "Show all categories" toggle
// (utility players, or an event that intentionally scores every tool).
//
// Each rule: lowercase keywords tested against the category name → the set of
// position codes (incl. group codes) for which that category applies.
const POSITION_CATEGORY_RULES = [
  { match: ["catch", "receiv"], positions: ["C"] },
  { match: ["pitch", "mound"], positions: ["P", "RHP", "LHP"] },
  { match: ["infield"], positions: ["1B", "2B", "3B", "SS", "IF"] },
  { match: ["outfield"], positions: ["LF", "CF", "RF", "OF"] },
];

// A rule that lists a group code (IF/OF) is satisfied by any group member too.
const POSITION_GROUP_MEMBERS = {
  IF: ["1B", "2B", "3B", "SS", "IF"],
  OF: ["LF", "CF", "RF", "OF"],
};

const ruleMatchesPositions = (rulePositions, athletePositions) => {
  const want = new Set();
  rulePositions.forEach((p) => {
    want.add(p);
    (POSITION_GROUP_MEMBERS[p] || []).forEach((m) => want.add(m));
  });
  return athletePositions.some((p) => want.has(p));
};

// { specific: is this category position-gated at all?, applies: should it show? }
const categoryApplicability = (catName, athletePositions) => {
  const lc = (catName || "").toLowerCase();
  const rule = POSITION_CATEGORY_RULES.find((r) => r.match.some((k) => lc.includes(k)));
  if (!rule) return { specific: false, applies: true };
  return { specific: true, applies: ruleMatchesPositions(rule.positions, athletePositions) };
};

const fmtBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

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
  const [mediaPreview, setMediaPreview] = useState(null);
  const [mediaCategory, setMediaCategory] = useState("Hitting");
  const [mediaPrivate, setMediaPrivate] = useState(false);
  const [mediaDesc, setMediaDesc] = useState("");
  const [mediaConsent, setMediaConsent] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaQueued, setMediaQueued] = useState(0);
  const [storageWarn, setStorageWarn] = useState(null);
  const [evaluateAs, setEvaluateAs] = useState("");
  // Spec §9: default to the position-filtered view; evaluators can reveal all.
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [resolutionReason, setResolutionReason] = useState(null);
  const [overrideBusy, setOverrideBusy] = useState(false);
  const saveTimer = useRef(null);
  const pendingRef = useRef(false);
  const retryTimer = useRef(null);
  const retryAttempt = useRef(0);
  const inflightRef = useRef(false);
  // Last draft we produced, in memory. Used only as a read fallback when
  // localStorage is unavailable/full so a retry still has something to push.
  const lastDraftRef = useRef(null);
  const mediaFlushRef = useRef(false);
  const captureInputRef = useRef(null);
  const pickInputRef = useRef(null);
  const mediaUrlRef = useRef(null);
  // Presentational only — lets the sticky footer's note shortcut scroll to comments.
  const commentsRef = useRef(null);

  // Reads the freshest draft available synchronously.
  const currentDraft = useCallback(
    () => readDraftLocal(evaluationId) || lastDraftRef.current,
    [evaluationId],
  );

  // Clears the draft from BOTH stores. Only ever called after an explicit
  // server acknowledgement — see the ack checks in pushSave().
  const clearDraft = useCallback(() => {
    deleteDraft(evaluationId);
    lastDraftRef.current = null;
    setStorageWarn(null);
  }, [evaluationId]);

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
        // Age band matters: a 10U and a 17U pitcher resolve to different
        // templates on the server, so the offline mirror must be given it too.
        const { template: t } = resolveTemplateLocal(pack.templates, {
          position: pos,
          stationTemplateId: pack.station_template_id || evaluation.station_template_id,
          ageGroup: evaluation?.athlete?.age_group || null,
        });
        return t;
      }
    }
    return null;
  }, [evaluation, evaluationId, evaluateAs]);

  // ---------- Position-based category filter (spec §9) ----------
  // Athlete's positions = the override we're evaluating them as (if any) +
  // registered primary + secondaries. If none are known, degrade to showing
  // everything (never hide a category we can't reason about).
  const athletePositions = useMemo(() => {
    const a = evaluation?.athlete || {};
    const list = [
      evaluateAs || evaluation?.evaluated_as_position,
      a.primary_position,
      ...(Array.isArray(a.secondary_positions) ? a.secondary_positions : []),
    ];
    return [...new Set(list.filter(Boolean).map((p) => String(p).toUpperCase()))];
  }, [evaluation, evaluateAs]);
  const positionsKnown = athletePositions.length > 0;

  const isCategoryVisible = useCallback((cat) => {
    if (showAllCategories || !positionsKnown) return true;
    return categoryApplicability(cat, athletePositions).applies;
  }, [showAllCategories, positionsKnown, athletePositions]);

  // Position-specific categories that don't apply to this athlete. Drives the
  // "Show all categories" toggle; independent of the toggle's current state so
  // the control stays visible after the evaluator reveals everything.
  const filterableHidden = useMemo(() => {
    if (!positionsKnown) return [];
    return [...new Set((template?.metrics || []).map((m) => m.category))].filter((c) => {
      const { specific, applies } = categoryApplicability(c, athletePositions);
      return specific && !applies;
    });
  }, [template, positionsKnown, athletePositions]);

  // Only metrics in visible categories count toward completion / required math.
  const visibleMetrics = useMemo(
    () => (template?.metrics || []).filter((m) => isCategoryVisible(m.category)),
    [template, isCategoryVisible],
  );

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
          clearDraft();
          setSaveStatus("saved");
          setLastSaved(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
          toast.info("Loaded a newer save from the server.");
        } catch {
          setSaveStatus("error");
          pendingRef.current = true;
        }
        return;
      }
      // Only clear the local draft after an explicit server save ack. A captive
      // portal answers 200 with HTML, so a missing status is not a save.
      if (status === "saved") {
        setSaveStatus("saved");
        setLastSaved(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
        pendingRef.current = false;
        retryAttempt.current = 0;
        clearDraft();
      } else {
        // Unknown status — keep draft, surface error
        setSaveStatus("error");
        pendingRef.current = true;
      }
    } catch (e) {
      if (e?.response?.status === 409) {
        setSaveStatus("error");
        toast.error("This evaluation is locked and can no longer be edited.");
        clearDraft();
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
              const local = currentDraft();
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
          const local = currentDraft();
          if (local) {
            setSaveStatus("sync_pending");
            setTimeout(() => pushSave(local.scores, local.comments, local.client_updated_at), 50);
          }
        } catch { /* ignore */ }
      }
    }
  }, [evaluationId, clearDraft, currentDraft]);

  const queueSave = useCallback((s, c) => {
    const clientTs = new Date().toISOString();
    const draft = { scores: s, comments: c, client_updated_at: clientTs };
    // always keep a local copy first (offline resilience). saveDraft writes
    // localStorage synchronously and mirrors to IndexedDB; it can never throw
    // into this path, so a full disk no longer aborts the save.
    lastDraftRef.current = draft;
    const res = saveDraft(evaluationId, draft);
    if (res.ok) {
      setStorageWarn(null);
    } else {
      res.durable.then((durable) => {
        setStorageWarn(durable
          ? "Device storage full — draft kept in the offline database. Sync when you have signal."
          : "Device storage full — this draft may not survive a reload. Sync now.");
      });
    }
    pendingRef.current = true;
    setSaveStatus((prev) => (prev === "offline" ? "offline" : "saving"));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => pushSave(s, c, clientTs), 650);
  }, [evaluationId, pushSave]);

  // ---------- Load evaluation + restore offline draft ----------
  useEffect(() => {
    let cancelled = false;
    api.get(`/evaluations/${evaluationId}`).then(async (r) => {
      if (cancelled) return;
      const ev = r.data;
      let s = ev.scores || {};
      let c = ev.comments || { strengths: "", development_needs: "", general: "", quick_tags: [] };
      // restore local draft if newer than server copy — from whichever of
      // localStorage / IndexedDB holds the newer client_updated_at
      try {
        const local = await loadDraftBest(evaluationId);
        if (cancelled) return;
        if (local) lastDraftRef.current = local;
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
      saveEvalSnapshot(evaluationId, {
        template: ev.template,
        meta: {
          athlete: ev.athlete,
          bib_number: ev.bib_number,
          jersey_number: ev.jersey_number,
          station_name: ev.station_name,
          event_name: ev.event_name,
          assignment_id: ev.assignment_id,
          athlete_id: ev.athlete_id,
          event_id: ev.event_id,
          station_id: ev.station_id,
          resolved_position: ev.resolved_position,
          evaluated_as_position: ev.evaluated_as_position,
        },
      });
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
    }).catch(async (e) => {
      // Offline: try to keep working from local draft + cached template
      try {
        const local = await loadDraftBest(evaluationId);
        if (cancelled) return;
        if (local) lastDraftRef.current = local;
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
      const draft = { scores, comments, client_updated_at: clientTs, evaluated_as_position: pos || null };
      lastDraftRef.current = draft;
      saveDraft(evaluationId, draft);
      if (!navigator.onLine) {
        // Resolve from offline cache
        const pack = loadStationTemplates(evaluation.event_id, evaluation.station_id);
        if (pack?.templates) {
          const { template: t, reason } = resolveTemplateLocal(pack.templates, {
            position: pos || evaluation.athlete?.primary_position,
            stationTemplateId: pack.station_template_id || evaluation.station_template_id,
            ageGroup: evaluation.athlete?.age_group || null,
          });
          if (!t) {
            toast.error("No template available offline for that position.");
            return;
          }
          setEvaluation((ev) => ({ ...ev, template: t, evaluated_as_position: pos || null, resolved_position: pos || ev.athlete?.primary_position }));
          setResolutionReason(reason);
          saveEvalSnapshot(evaluationId, { template: t });
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
      if (fresh.data.template) saveEvalSnapshot(evaluationId, { template: fresh.data.template });
      setSaveStatus("saved");
      // Explicit ack only — a captive-portal 200 must never clear a draft.
      if (r?.data?.status === "saved") clearDraft();
      toast.success(pos ? `Evaluating as ${pos}` : "Using registered position");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setOverrideBusy(false);
    }
  };
  // ---------- Offline media queue (spec §11) ----------
  // Consent is enforced at queue time and re-checked here: a record without a
  // verified consent flag is never sent. Under-13 handling stays server-side
  // (the upload is filed as pending_consent and is not published).
  const uploadMediaRecord = useCallback(async (rec) => {
    const fd = new FormData();
    fd.append("file", rec.blob, rec.file_name || "capture");
    fd.append("athlete_id", rec.athlete_id);
    if (rec.event_id) fd.append("event_id", rec.event_id);
    if (rec.evaluation_id) fd.append("evaluation_id", rec.evaluation_id);
    fd.append("description", rec.description || "");
    fd.append("consent_verified", "true");
    fd.append("is_profile_photo", rec.is_profile_photo ? "true" : "false");
    // Spec §11: "mark private" is now an enforced server-side ACL, not a note.
    fd.append("is_private", rec.is_private ? "true" : "false");
    const r = await api.post("/media/upload", fd);
    // Same rule as the draft ack: require an explicit server acknowledgement
    // (a stored media id). A captive-portal HTML 200 is not an upload.
    if (!r?.data?.id) {
      const err = new Error("Upload was not acknowledged by the server.");
      err.unacked = true;
      throw err;
    }
    return r.data;
  }, []);

  const flushMediaQueue = useCallback(async (announce = false) => {
    if (mediaFlushRef.current) return;
    mediaFlushRef.current = true;
    try {
      const items = await listQueuedMedia();
      if (!items.length) { setMediaQueued(0); return; }
      setMediaQueued(items.length);
      if (!navigator.onLine) return;
      let sent = 0;
      for (const it of items) {
        if (!it.consent_verified) continue; // never upload without verified consent
        try {
          await uploadMediaRecord(it);
          await deleteQueuedMedia(it.id);
          sent += 1;
        } catch (e) {
          const st = e?.response?.status;
          // A permanent server rejection (bad type / too large) would otherwise
          // block the queue forever. Drop it and say so.
          if (st && st >= 400 && st < 500 && ![401, 408, 429].includes(st)) {
            await deleteQueuedMedia(it.id);
            toast.error(`Queued media "${it.file_name}" was rejected: ${errMsg(e)}`);
            continue;
          }
          break; // transient — keep this and the rest queued
        }
      }
      const left = await countQueuedMedia();
      setMediaQueued(left);
      if (sent) toast.success(`${sent} queued media file${sent > 1 ? "s" : ""} uploaded.`);
      else if (announce && left) toast.message(`${left} media file${left > 1 ? "s" : ""} still waiting to upload.`);
    } catch {
      /* leave the queue intact */
    } finally {
      mediaFlushRef.current = false;
    }
  }, [uploadMediaRecord]);

  // Warm the offline app shell + surface anything left in the media queue.
  useEffect(() => {
    registerAppShell();
    flushMediaQueue();
  }, [flushMediaQueue]);

  // flush pending saves when connection returns
  useEffect(() => {
    const onOnline = () => {
      try {
        const local = currentDraft();
        if (local || pendingRef.current) {
          setSaveStatus("sync_pending");
          if (local) pushSave(local.scores, local.comments, local.client_updated_at);
        }
      } catch { /* ignore */ }
      flushMediaQueue(true);
    };
    const onOffline = () => setSaveStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [evaluationId, pushSave, currentDraft, flushMediaQueue]);

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
  // Count only VISIBLE metrics — an infielder isn't "incomplete" for hidden
  // catching metrics (spec §9). Entered scores in hidden categories are never
  // dropped from `scores`; this is a display/counting filter only.
  const scorableMetrics = useMemo(() => visibleMetrics.filter((m) => !["comment", "observation"].includes(m.metric_type)), [visibleMetrics]);
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
      const local = currentDraft();
      if (!local && !pendingRef.current) return true;
      if (!navigator.onLine) {
        setSaveStatus("offline");
        return false;
      }
      setSaveStatus("sync_pending");
      if (local) await pushSave(local.scores, local.comments, local.client_updated_at);
      // Synced only when nothing is pending AND the local draft is gone, which
      // clearDraft() does only on an explicit server ack.
      return !(pendingRef.current || readDraftLocal(evaluationId));
    } catch {
      return false;
    }
  };

  const retrySync = () => {
    try {
      const local = currentDraft();
      if (local) {
        setSaveStatus("sync_pending");
        pushSave(local.scores, local.comments, local.client_updated_at);
      }
      flushMediaQueue(true);
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
      // Server accepted the submit (a non-2xx would have thrown) — safe to clear.
      clearDraft();
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

  // ---------- Media capture / upload (spec §11) ----------
  // Object URLs are tracked in a ref, not read out of state inside an updater —
  // StrictMode double-invokes updaters, so side effects must not live there.
  const revokePreview = useCallback(() => {
    if (mediaUrlRef.current) {
      try { URL.revokeObjectURL(mediaUrlRef.current); } catch { /* ignore */ }
      mediaUrlRef.current = null;
    }
  }, []);

  const resetMedia = useCallback(() => {
    revokePreview();
    setMediaPreview(null);
    setMediaFile(null);
    setMediaDesc("");
    setMediaPrivate(false);
    setMediaConsent(false);
    setMediaCategory("Hitting");
    if (captureInputRef.current) captureInputRef.current.value = "";
    if (pickInputRef.current) pickInputRef.current.value = "";
  }, [revokePreview]);

  // Release any preview object URL when leaving the form.
  useEffect(() => revokePreview, [revokePreview]);

  // Client-side guards so a doomed file fails here, not after a multi-minute
  // push over camp wifi (and never sits in the queue blocking everything else).
  const pickMediaFile = (file) => {
    if (!file) return;
    const ext = mediaExtOf(file.name);
    if (ext && !MEDIA_ALLOWED_EXT.includes(ext)) {
      toast.error(`Unsupported file type ${ext}. Use JPG, PNG, WEBP, HEIC, MP4, MOV or WEBM.`);
      return;
    }
    if (file.size > MEDIA_MAX_BYTES) {
      toast.error(`That file is ${fmtBytes(file.size)} — the limit is ${fmtBytes(MEDIA_MAX_BYTES)}. Record a shorter clip.`);
      return;
    }
    if (file.size > MEDIA_WARN_BYTES) {
      toast.warning(`${fmtBytes(file.size)} is large for camp wifi — a 5-10 second clip uploads far more reliably.`);
    }
    revokePreview();
    let url = null;
    try { url = URL.createObjectURL(file); } catch { /* preview unavailable */ }
    mediaUrlRef.current = url;
    setMediaFile(file);
    setMediaPreview({ url, kind: file.type?.startsWith("video") ? "video" : "image" });
    if (file.type?.startsWith("video") && mediaCategory === "Profile photo") setMediaCategory("Hitting");
  };

  const buildMediaDescription = () => {
    const parts = [];
    if (mediaCategory && mediaCategory !== "Other") parts.push(`[${mediaCategory}]`);
    if (mediaDesc.trim()) parts.push(mediaDesc.trim());
    // Privacy is no longer smuggled into the description — it is sent as the
    // `is_private` field and enforced server-side (staff-only, never public).
    return parts.join(" ");
  };

  const submitMedia = async () => {
    if (!mediaFile || !mediaConsent) return;
    setMediaBusy(true);
    const record = {
      athlete_id: evaluation.athlete_id,
      event_id: evaluation.event_id,
      evaluation_id: evaluationId,
      blob: mediaFile,
      file_name: mediaFile.name || "capture",
      description: buildMediaDescription(),
      consent_verified: true,
      is_profile_photo: mediaCategory === "Profile photo" && !mediaFile.type?.startsWith("video"),
      category: mediaCategory,
      is_private: mediaPrivate,
      athlete_label: `${evaluation.athlete?.first_name || ""} ${evaluation.athlete?.last_name || ""}`.trim(),
    };
    try {
      if (!navigator.onLine) {
        const id = await queueMedia(record);
        if (!id) {
          // Be honest: without IndexedDB we cannot hold the file.
          toast.error("Offline and this device has no durable storage — keep this screen open and upload once you have signal.");
          return;
        }
        setMediaQueued(await countQueuedMedia());
        toast.success("Saved on this device. It will upload automatically when you reconnect.");
        setMediaOpen(false);
        resetMedia();
        return;
      }
      await uploadMediaRecord(record);
      toast.success("Media uploaded and submitted for approval.");
      setMediaOpen(false);
      resetMedia();
    } catch (e) {
      // Network failure mid-upload: queue rather than lose the capture.
      const transient = !navigator.onLine || e?.code === "ERR_NETWORK" || e?.unacked || !e?.response;
      if (transient) {
        const id = await queueMedia(record);
        if (id) {
          setMediaQueued(await countQueuedMedia());
          toast.message("Upload failed — saved on this device and queued for retry.");
          setMediaOpen(false);
          resetMedia();
          return;
        }
      }
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
  const categories = [...new Set((template?.metrics || []).map((m) => m.category))].filter(isCategoryVisible);

  return (
    <div className="max-w-2xl mx-auto -mt-2">
      {/* Sticky identity card — photo, name and BIG bib stay visible while scrolling scores */}
      <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2.5 bg-background/95 border-b border-divider" data-testid="evaluation-sticky-header">
        <div className="flex items-center gap-2.5">
          <button onClick={() => navigate(`/evaluate/${evaluation.assignment_id}`)} className="inline-flex items-center justify-center text-info min-h-[44px] min-w-[36px] shrink-0" aria-label="Back to player list" data-testid="evaluation-back-button">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <PlayerAvatar firstName={athlete.first_name} lastName={athlete.last_name} photoUrl={athlete.photo_url} size="lg" bib={evaluation.bib_number} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5 min-w-0">
              {evaluation.bib_number != null && evaluation.bib_number !== "" && (
                <span className="font-mono-num font-extrabold text-2xl text-brand leading-none shrink-0">#{evaluation.bib_number}</span>
              )}
              <p className="font-semibold text-base text-foreground truncate" data-testid="evaluation-player-name">
                {(athlete.first_name || athlete.last_name) ? `${athlete.first_name || ""} ${athlete.last_name || ""}`.trim() : "—"}
              </p>
            </div>
            <div className="flex items-center gap-1.5 mt-1 min-w-0">
              <span
                className="inline-flex items-center rounded-full bg-brand text-primary-foreground px-2 py-0.5 text-[10px] font-bold tracking-wide shrink-0"
                data-testid="resolved-position-badge"
              >
                {evaluateAs || evaluation.resolved_position || athlete.primary_position || "POS?"}
              </span>
              <span className="text-[11px] text-muted-foreground truncate">
                {athlete.age_group || "—"}{evaluation.station_name ? ` · ${evaluation.station_name}` : ""}
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {locked ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/15 border border-success/40 text-success px-2.5 py-1 text-xs font-semibold">
                <Lock className="h-3 w-3" /> Locked
              </span>
            ) : (
              <SaveStatusPill status={saveStatus} lastSaved={lastSaved} onRetry={retrySync} warning={storageWarn} />
            )}
            <p className="font-mono-num text-xs font-bold text-foreground leading-none">
              {completionPct}%
              <span className={cn("ml-1 font-sans font-semibold", missingRequired.length ? "text-warning" : "text-success")}>
                {missingRequired.length ? `· ${missingRequired.length} req` : "· done"}
              </span>
            </p>
          </div>
        </div>
        <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-300", missingRequired.length ? "bg-warning" : "bg-success")}
            style={{ width: `${completionPct}%` }}
          />
        </div>
      </div>

      {/* Secondary detail lives behind a collapsible so the scoring flow stays clean */}
      <details className="group mt-3 mb-4 rounded-xl border border-border bg-card" data-testid="evaluation-details-collapsible">
        <summary className="flex items-center justify-between gap-2 px-3 min-h-[44px] cursor-pointer list-none [&::-webkit-details-marker]:hidden text-xs font-semibold text-muted-foreground uppercase tracking-wide select-none">
          Details &amp; position override
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-divider">
          <p className="text-xs text-muted-foreground">
            {evaluation.event_name || "—"}{evaluation.station_name ? ` · ${evaluation.station_name}` : ""}
            {resolutionReason && (
              <span className="uppercase tracking-wide" data-testid="resolution-reason">
                {" "}· template via {resolutionReason.replace(/_/g, " ")}
              </span>
            )}
          </p>
          {!locked && (
            <div className="flex flex-wrap items-center gap-2">
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
        </div>
      </details>

      {storageWarn && (
        <div className="mb-4 rounded-xl bg-warning/15 border border-warning/40 px-4 py-3 text-sm text-warning" data-testid="storage-warning-banner">
          {storageWarn}
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

      {/* Spec §9 — position filter notice + override. Only shown when there is
          actually a position-specific category to hide for this athlete. */}
      {filterableHidden.length > 0 && !locked && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5" data-testid="category-filter-bar">
          <p className="text-[11px] text-muted-foreground min-w-0">
            {showAllCategories
              ? "Showing all categories, including ones outside this player's positions."
              : `Showing categories for ${athletePositions.join(", ")}. ${filterableHidden.length} position-specific ${filterableHidden.length > 1 ? "categories" : "category"} hidden (${filterableHidden.join(", ")}).`}
          </p>
          <button
            type="button"
            onClick={() => setShowAllCategories((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary text-foreground px-3 min-h-[40px] text-xs font-semibold shrink-0"
            data-testid="toggle-all-categories"
          >
            {showAllCategories ? "Filter to position" : "Show all categories"}
          </button>
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
        <div ref={commentsRef} className="scroll-mt-32">
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
                    className={cn("rounded-full border px-3.5 min-h-[44px] text-xs font-semibold transition active:scale-[0.96]",
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
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" className="rounded-xl h-12" onClick={() => setMediaOpen(true)} disabled={locked} data-testid="add-media-button">
                <Camera className="h-4 w-4 mr-1.5" /> Add Photo / Video
              </Button>
              {mediaQueued > 0 && (
                <button
                  type="button"
                  onClick={() => flushMediaQueue(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/15 text-warning px-3 min-h-[44px] text-xs font-semibold"
                  data-testid="media-queue-chip"
                  title="Queued on this device — tap to retry the upload"
                >
                  <CloudUpload className="h-3.5 w-3.5" />
                  {mediaQueued} waiting to upload
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Sticky footer — sits above bottom nav only when nav is visible; evaluation route hides tabs */}
      <div className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 mt-6 px-4 sm:px-6 py-3 bg-card border-t safe-bottom-pad">
        <div className="flex items-center gap-2">
          <Button variant="outline" className="rounded-xl h-14 px-2 min-w-[56px] flex-col gap-0.5" disabled={!prevPlayer} onClick={() => goTo(-1)} data-testid="prev-player-button" aria-label={prevPlayer ? `Previous player: ${prevPlayer.first_name} ${prevPlayer.last_name}` : "Previous player"} title={prevPlayer ? `${prevPlayer.first_name} ${prevPlayer.last_name}` : ""}>
            <ChevronLeft className="h-5 w-5" />
            {prevPlayer && (
              <span className="text-[10px] font-semibold leading-none truncate max-w-[72px]">
                {prevPlayer.bib_number ? `#${prevPlayer.bib_number} ` : ""}{prevPlayer.last_name || prevPlayer.first_name}
              </span>
            )}
          </Button>
          {!locked && (
            <Button variant="outline" className="rounded-xl h-14 w-12 px-0 shrink-0" onClick={() => commentsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} aria-label="Jump to notes" title="Jump to notes" data-testid="jump-to-notes-button">
              <MessageSquarePlus className="h-5 w-5" />
            </Button>
          )}
          {!locked ? (
            <Button className="flex-1 rounded-xl h-14 bg-brand hover:bg-brand-secondary text-base font-semibold active:scale-[0.98]" onClick={() => setSubmitOpen(true)} data-testid="evaluation-submit-button">
              <Send className="h-4 w-4 mr-1.5" /> Submit
            </Button>
          ) : (
            <Button className="flex-1 rounded-xl h-14 bg-brand hover:bg-brand-secondary text-base font-semibold" onClick={() => nextPlayer ? goTo(1) : navigate(`/evaluate/${evaluation.assignment_id}`)} data-testid="post-submit-next">
              {nextPlayer ? `Next · ${nextPlayer.bib_number ? `#${nextPlayer.bib_number} ` : ""}${nextPlayer.last_name || nextPlayer.first_name}` : "Back to list"}
            </Button>
          )}
          <Button variant="outline" className="rounded-xl h-14 px-2 min-w-[56px] flex-col gap-0.5" disabled={!nextPlayer} onClick={() => goTo(1)} data-testid="next-player-button" aria-label={nextPlayer ? `Next player: ${nextPlayer.first_name} ${nextPlayer.last_name}` : "Next player"} title={nextPlayer ? `${nextPlayer.first_name} ${nextPlayer.last_name}` : ""}>
            <ChevronRight className="h-5 w-5" />
            {nextPlayer && (
              <span className="text-[10px] font-semibold leading-none truncate max-w-[72px]">
                {nextPlayer.bib_number ? `#${nextPlayer.bib_number} ` : ""}{nextPlayer.last_name || nextPlayer.first_name}
              </span>
            )}
          </Button>
        </div>
        {missingRequired.length > 0 && !locked && (
          <p className="text-[11px] text-center text-warning font-semibold mt-1.5 truncate" data-testid="footer-missing-required">
            {missingRequired.length} required metric{missingRequired.length > 1 ? "s" : ""} still empty
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

      {/* Media dialog — capture / preview / retake, then attach to this player + evaluation */}
      <Dialog open={mediaOpen} onOpenChange={(o) => { setMediaOpen(o); if (!o) resetMedia(); }}>
        <DialogContent className="rounded-2xl max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display text-2xl text-foreground">Add Media</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground -mt-1">
              Attaching to <span className="font-semibold text-foreground">{athlete.first_name} {athlete.last_name}</span>
              {evaluation.bib_number ? ` · #${evaluation.bib_number}` : ""} · this evaluation
            </p>

            {/* Hidden inputs: one for live capture, one for the library */}
            <input
              ref={captureInputRef} type="file" accept="image/*,video/*" capture="environment" className="hidden"
              onChange={(e) => pickMediaFile(e.target.files?.[0])} data-testid="media-file-input"
            />
            <input
              ref={pickInputRef} type="file" accept="image/*,video/*" className="hidden"
              onChange={(e) => pickMediaFile(e.target.files?.[0])} data-testid="media-file-picker"
            />

            {!mediaFile ? (
              <div className="grid grid-cols-1 gap-2">
                <Button variant="outline" className="rounded-xl h-14 justify-start text-base" onClick={() => captureInputRef.current?.click()} data-testid="media-capture-button">
                  <Camera className="h-5 w-5 mr-2" /> Take photo / record video
                </Button>
                <Button variant="outline" className="rounded-xl h-14 justify-start text-base" onClick={() => pickInputRef.current?.click()} data-testid="media-choose-button">
                  <Upload className="h-5 w-5 mr-2" /> Upload an existing file
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Max {fmtBytes(MEDIA_MAX_BYTES)}. Short clips (5–10s) upload far more reliably on camp wifi.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="rounded-xl overflow-hidden border border-border bg-secondary" data-testid="media-preview">
                  {mediaPreview?.url && mediaPreview.kind === "video" ? (
                    <video src={mediaPreview.url} controls playsInline className="w-full max-h-56 bg-black" />
                  ) : mediaPreview?.url && !mediaPreview.failed ? (
                    // HEIC and some codecs will not decode in every browser —
                    // fall back to the text notice rather than a broken image.
                    <img
                      src={mediaPreview.url}
                      alt="Capture preview"
                      className="w-full max-h-56 object-contain bg-black"
                      onError={() => setMediaPreview((p) => (p ? { ...p, failed: true } : p))}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground p-4 text-center">
                      Preview unavailable on this device — the file is still attached and will upload.
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground truncate min-w-0">
                    {mediaFile.name} · <span className="font-mono-num">{fmtBytes(mediaFile.size)}</span>
                  </p>
                  <Button variant="outline" size="sm" className="rounded-xl h-10 shrink-0" onClick={() => { resetMedia(); }} data-testid="media-retake-button">
                    <RotateCcw className="h-4 w-4 mr-1.5" /> Retake
                  </Button>
                </div>

                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">What is this?</p>
                  <div className="flex flex-wrap gap-1.5" data-testid="media-category-picker">
                    {MEDIA_CATEGORIES.map((c) => {
                      const isVideo = mediaFile.type?.startsWith("video");
                      const disabled = c === "Profile photo" && isVideo;
                      return (
                        <button
                          key={c} type="button" disabled={disabled} onClick={() => setMediaCategory(c)}
                          className={cn(
                            "rounded-full border px-3.5 h-11 text-xs font-semibold transition active:scale-[0.96]",
                            mediaCategory === c ? "bg-primary text-white border-transparent" : "bg-card text-muted-foreground border-border",
                            disabled && "opacity-40",
                          )}
                        >
                          {c}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <Textarea
                  value={mediaDesc} onChange={(e) => setMediaDesc(e.target.value)} rows={2} maxLength={200}
                  placeholder="Short caption (optional)" className="rounded-xl" data-testid="media-caption-input"
                />

                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={mediaPrivate} onCheckedChange={setMediaPrivate} data-testid="media-private-checkbox" className="mt-0.5" />
                  Mark private — staff-only. Never shown on the player&apos;s public profile or to parents, even after consent.
                </label>
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={mediaConsent} onCheckedChange={setMediaConsent} data-testid="media-consent-checkbox" className="mt-0.5" />
                  I confirm media consent has been verified for this athlete (required for minors).
                </label>
                <p className="text-[11px] text-muted-foreground">
                  Uploads are submitted for approval. Media for players under 13 is held as pending consent and is not shown until a guardian approves it.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              className="w-full rounded-xl bg-primary hover:bg-brand-secondary h-12 text-base"
              disabled={!mediaFile || !mediaConsent || mediaBusy}
              onClick={submitMedia}
              data-testid="media-upload-button"
            >
              {mediaBusy ? "Working…" : navigator.onLine ? "Submit for approval" : "Save on device & upload later"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
