import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { saveStationTemplates } from "@/lib/templateCache";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, ClipboardCheck, Loader2, Search, Users, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

// Returned-for-revision first so evaluators clear head-scout feedback before new starts.
const STATUS_RANK = { returned: 0, not_started: 1, draft: 2, submitted: 3, approved: 4 };

function isDone(status) {
  return ["submitted", "approved"].includes(status);
}
function isInProgress(status) {
  return ["draft", "returned"].includes(status);
}

export default function Evaluate() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState(null);
  const [athletes, setAthletes] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("todo"); // todo | all | done
  const [starting, setStarting] = useState(null);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffQ, setHandoffQ] = useState("");
  const [handoffResults, setHandoffResults] = useState([]);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [cacheStatus, setCacheStatus] = useState(null);
  const handoffTimer = useRef(null);
  const handoffAbort = useRef(null);

  useEffect(() => {
    api.get("/my-assignments").then((r) => setAssignments(r.data));
  }, []);

  useEffect(() => {
    if (!assignmentId) { setAthletes(null); return; }
    api.get(`/my-assignments/${assignmentId}/athletes`).then((r) => setAthletes(r.data)).catch((e) => toast.error(errMsg(e)));
  }, [assignmentId]);

  useEffect(() => {
    if (!assignmentId || !assignments) return;
    const a = assignments.find((x) => x.id === assignmentId);
    if (!a?.event_id || !a?.station_id) return;
    api.get("/evaluations/templates-for-station", {
      params: { event_id: a.event_id, station_id: a.station_id },
    }).then((r) => {
      const ok = saveStationTemplates(a.event_id, a.station_id, r.data);
      const n = (r.data.templates || []).length;
      setCacheStatus(ok === false
        ? `⚠ ${n} templates fetched but device cache failed — stay on wifi`
        : `${n} templates cached for offline`);
    }).catch(() => {
      setCacheStatus("⚠ Offline — using previously cached templates if available");
    });
  }, [assignmentId, assignments]);

  const startEval = async (athleteId, { allowUnassigned = false, position = null } = {}) => {
    if (!navigator.onLine) {
      toast.error("You're offline. Reconnect to start a new player. Already-opened drafts still work.");
      return;
    }
    setStarting(athleteId);
    try {
      const body = { assignment_id: assignmentId, athlete_id: athleteId, allow_unassigned: allowUnassigned };
      if (position) body.evaluated_as_position = position;
      const r = await api.post("/evaluations/start", body);
      navigate(`/evaluation/${r.data.id}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setStarting(null);
    }
  };

  const openPlayer = (p, opts = {}) => {
    if (p.evaluation_id) navigate(`/evaluation/${p.evaluation_id}`);
    else startEval(p.athlete_id, opts);
  };

  const runHandoffSearch = useCallback(async (q) => {
    setHandoffQ(q);
    const a = assignments?.find((x) => x.id === assignmentId);
    if (!a?.event_id) return;
    if (handoffAbort.current) handoffAbort.current.abort();
    const ctrl = new AbortController();
    handoffAbort.current = ctrl;
    setHandoffBusy(true);
    try {
      const r = await api.get(`/events/${a.event_id}/roster/search`, {
        params: { q },
        signal: ctrl.signal,
      });
      setHandoffResults(r.data || []);
    } catch (e) {
      if (e?.code === "ERR_CANCELED" || e?.name === "CanceledError") return;
      toast.error(errMsg(e));
    } finally {
      setHandoffBusy(false);
    }
  }, [assignments, assignmentId]);

  const onHandoffChange = (q) => {
    setHandoffQ(q);
    if (handoffTimer.current) clearTimeout(handoffTimer.current);
    handoffTimer.current = setTimeout(() => runHandoffSearch(q), 350);
  };

  // Hooks must run unconditionally (before any early return)
  const assignment = assignments?.find((a) => a.id === assignmentId);
  const counts = useMemo(() => {
    const list = athletes || [];
    return {
      total: list.length,
      done: list.filter((p) => isDone(p.evaluation_status)).length,
      progress: list.filter((p) => isInProgress(p.evaluation_status)).length,
      todo: list.filter((p) => !isDone(p.evaluation_status)).length,
    };
  }, [athletes]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = (athletes || []).filter((p) => {
      if (filter === "todo" && isDone(p.evaluation_status)) return false;
      if (filter === "done" && !isDone(p.evaluation_status)) return false;
      if (!q) return true;
      const hay = `${p.first_name} ${p.last_name} ${p.bib_number || ""} ${p.jersey_number || ""}`.toLowerCase();
      return hay.includes(q);
    });
    list = [...list].sort((a, b) => {
      const ra = STATUS_RANK[a.evaluation_status] ?? 0;
      const rb = STATUS_RANK[b.evaluation_status] ?? 0;
      if (ra !== rb) return ra - rb;
      return `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`);
    });
    return list;
  }, [athletes, search, filter]);

  const nextTodo = useMemo(
    () => (athletes || []).find((p) => !isDone(p.evaluation_status)),
    [athletes],
  );

  // ---- Assignment picker ----
  if (!assignmentId) {
    if (!assignments) return <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>;
    return (
      <div className="space-y-4">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl text-foreground">Evaluate</h1>
          <p className="text-sm text-muted-foreground">Select your station — templates cache when you open it.</p>
        </div>
        {assignments.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="No assignments" hint="You are not assigned to any station yet. Ask your administrator." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {assignments.map((a) => {
              const remaining = Math.max(0, (a.expected || 0) - (a.completed || 0));
              return (
                <Card key={a.id} className="rounded-2xl border-border cursor-pointer hover:border-brand/50 transition active:scale-[0.99]" onClick={() => navigate(`/evaluate/${a.id}`)} data-testid={`assignment-card-${a.id}`}>
                  <CardContent className="pt-5 pb-5">
                    <p className="text-xs text-muted-foreground uppercase tracking-widest">{a.event?.name}</p>
                    <p className="font-display text-2xl text-foreground mt-0.5">{a.station?.name}</p>
                    <p className="text-sm text-muted-foreground">{(a.groups || []).map((g) => g.name).join(", ") || "All groups"}</p>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <p className="text-xs font-mono-num text-muted-foreground">
                        {a.completed}/{a.expected} submitted
                        {remaining > 0 ? ` · ${remaining} left` : " · done"}
                      </p>
                      <span className="inline-flex items-center gap-1 text-sm font-semibold text-brand">Open <ArrowRight className="h-4 w-4" /></span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-brand rounded-full transition-all"
                        style={{ width: `${a.expected ? Math.min(100, Math.round((a.completed / a.expected) * 100)) : 0}%` }}
                      />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ---- Player list for assignment ----
  return (
    <div className="space-y-3">
      <div>
        <button onClick={() => navigate("/evaluate")} className="inline-flex items-center gap-1 text-sm text-info hover:underline mb-1 min-h-[44px]" data-testid="back-to-assignments">
          <ArrowLeft className="h-3.5 w-3.5" /> My assignments
        </button>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl text-foreground">{assignment?.station?.name || "Station"}</h1>
            <p className="text-sm text-muted-foreground">{assignment?.event?.name}</p>
          </div>
          {nextTodo && (
            <Button
              className="rounded-xl h-11 bg-brand hover:bg-brand-secondary"
              onClick={() => openPlayer(nextTodo)}
              disabled={!!starting}
              data-testid="next-incomplete-button"
            >
              <Zap className="h-4 w-4 mr-1.5" />
              Next: {nextTodo.first_name} {nextTodo.last_name?.[0]}.
            </Button>
          )}
        </div>
        <p className="text-xs font-mono-num text-muted-foreground mt-1" data-testid="station-progress">
          {counts.done} submitted · {counts.progress} in progress · {counts.todo} remaining
        </p>
        {cacheStatus && <p className="text-[11px] text-muted-foreground mt-0.5" data-testid="template-cache-status">{cacheStatus}</p>}
        <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-success rounded-full transition-all"
            style={{ width: `${counts.total ? Math.round((counts.done / counts.total) * 100) : 0}%` }}
          />
        </div>
      </div>

      {/* Sticky search + filters */}
      <div className="sticky top-14 md:top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 bg-background/95 border-b border-divider space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or bib #…"
              className="pl-9 h-12 rounded-xl bg-card"
              data-testid="evaluate-player-search"
            />
          </div>
          <Button
            variant="outline"
            className="h-12 rounded-xl shrink-0"
            onClick={() => {
              const next = !handoffOpen;
              setHandoffOpen(next);
              if (next) runHandoffSearch("");
            }}
            data-testid="handoff-picker-toggle"
          >
            <Users className="h-4 w-4 mr-1.5" /> Full roster
          </Button>
        </div>
        <div className="flex gap-1.5" data-testid="evaluate-status-filters">
          {[
            { id: "todo", label: `Todo (${counts.todo})` },
            { id: "all", label: `All (${counts.total})` },
            { id: "done", label: `Done (${counts.done})` },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "h-9 px-3 rounded-full text-xs font-semibold border transition",
                filter === f.id
                  ? "bg-brand text-primary-foreground border-brand"
                  : "bg-card text-muted-foreground border-border"
              )}
              data-testid={`filter-${f.id}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {handoffOpen && (
        <Card className="rounded-2xl border-info/40 bg-info/10" data-testid="handoff-picker">
          <CardContent className="pt-4 pb-4 space-y-3">
            <div>
              <p className="font-semibold text-sm text-foreground">Hand off &amp; evaluate</p>
              <p className="text-xs text-muted-foreground">Full event roster — audited when started outside your group.</p>
            </div>
            <Input
              value={handoffQ}
              onChange={(e) => onHandoffChange(e.target.value)}
              placeholder="Search event roster…"
              className="h-12 rounded-xl bg-card"
              data-testid="handoff-search-input"
            />
            <div className="max-h-64 overflow-y-auto space-y-1.5 min-h-[3rem]">
              {handoffBusy && handoffResults.length === 0 ? (
                <Skeleton className="h-14 rounded-xl" />
              ) : handoffResults.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No matching players.</p>
              ) : (
                handoffResults.map((p) => (
                  <button
                    key={p.athlete_id}
                    type="button"
                    disabled={starting === p.athlete_id}
                    onClick={() => openPlayer(p, { allowUnassigned: true })}
                    className="w-full text-left rounded-xl border border-border bg-card px-3 py-3 flex items-center gap-3 hover:bg-secondary min-h-[56px]"
                    data-testid={`handoff-player-${p.athlete_id}`}
                  >
                    <PlayerAvatar firstName={p.first_name} lastName={p.last_name} bib={p.bib_number || p.jersey_number} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-foreground truncate">{p.first_name} {p.last_name}</p>
                      <p className="text-xs text-muted-foreground">
                        #{p.bib_number || p.jersey_number || "—"} · {p.age_group || "—"} · {p.primary_position || "—"}
                      </p>
                    </div>
                    {starting === p.athlete_id ? <Loader2 className="h-4 w-4 animate-spin text-brand" /> : <StatusBadge status={p.evaluation_status} />}
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {!athletes ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title={filter === "done" ? "No submitted players yet" : "No players in this filter"}
          hint={filter === "todo" ? "All caught up — switch to All or Done, or use Full roster." : "Try another search or filter."}
        />
      ) : (
        <div className="space-y-2 pb-2">
          {filtered.map((p) => (
            <button
              key={p.athlete_id}
              onClick={() => openPlayer(p)}
              disabled={starting === p.athlete_id}
              className="w-full text-left"
              data-testid={`evaluate-player-${p.athlete_id}`}
            >
              <Card className={cn(
                "rounded-2xl border-border hover:bg-secondary active:scale-[0.99] transition",
                isDone(p.evaluation_status) && "opacity-70"
              )}>
                <CardContent className="py-3.5 flex items-center gap-3 min-h-[64px]">
                  <PlayerAvatar firstName={p.first_name} lastName={p.last_name} bib={p.bib_number || p.jersey_number} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground truncate">{p.first_name} {p.last_name}</p>
                    <p className="text-xs text-muted-foreground">
                      #{p.bib_number || p.jersey_number || "—"} · {p.age_group || "—"} · {p.primary_position || "—"}
                      {p.group_name ? ` · ${p.group_name}` : ""}
                    </p>
                  </div>
                  {starting === p.athlete_id ? (
                    <Loader2 className="h-5 w-5 animate-spin text-brand shrink-0" />
                  ) : (
                    <>
                      <StatusBadge status={p.evaluation_status} />
                      <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </>
                  )}
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
