import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { saveStationTemplates, registerAppShell } from "@/lib/templateCache";
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

// Scoring is over in every one of these — the stations under them are history,
// not today's work, so they sit below the live events rather than above them.
// (Wider than the review queue's archive set on purpose: "Evaluation Complete"
// and "Review" still carry review work, but no new scores get entered.)
const FINISHED_EVENT_STATUSES = ["Evaluation Complete", "Review", "Published", "Closed", "Cancelled"];
const isFinishedEvent = (status) => FINISHED_EVENT_STATUSES.includes(status);

// A bare "2026-08-16" parses as UTC midnight and renders a day early in every
// US timezone; pin date-only strings to local midnight.
const eventDate = (iso) => {
  if (!iso) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

// Newest first; an undated event sinks below every dated one rather than
// sorting as the epoch, and the name breaks the remaining ties.
const compareEventGroups = (a, b) => {
  const ta = a.date ? new Date(a.date).getTime() : NaN;
  const tb = b.date ? new Date(b.date).getTime() : NaN;
  const va = Number.isNaN(ta) ? null : ta;
  const vb = Number.isNaN(tb) ? null : tb;
  if (va === null && vb !== null) return 1;
  if (vb === null && va !== null) return -1;
  if (va !== null && vb !== null && va !== vb) return vb - va;
  return (a.name || "").localeCompare(b.name || "");
};

/** Fold the flat assignment list into one entry per event, totals included. */
const groupAssignmentsByEvent = (assignments) => {
  const byEvent = new Map();
  (assignments || []).forEach((a) => {
    const id = a.event_id;
    if (!byEvent.has(id)) {
      byEvent.set(id, {
        key: id,
        name: a.event?.name || "Untitled event",
        date: a.event?.date || null,
        status: a.event?.status || null,
        finished: isFinishedEvent(a.event?.status),
        stations: [],
      });
    }
    byEvent.get(id).stations.push(a);
  });
  const groups = [...byEvent.values()];
  groups.forEach((g) => {
    g.expected = g.stations.reduce((n, a) => n + (a.expected || 0), 0);
    g.completed = g.stations.reduce((n, a) => n + (a.completed || 0), 0);
    g.remaining = Math.max(0, g.expected - g.completed);
  });
  return groups.sort(compareEventGroups);
};

const pct = (done, total) => (total ? Math.min(100, Math.round((done / total) * 100)) : 0);

const ProgressBar = ({ done, total, muted }) => (
  <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
    <div
      className={cn("h-full rounded-full transition-all", muted ? "bg-muted-foreground/50" : "bg-brand")}
      style={{ width: `${pct(done, total)}%` }}
    />
  </div>
);

// One station. Shared by the event drill-down and nothing else yet, but kept at
// module level so it is not redefined on every render.
const StationCard = ({ a, onOpen, muted }) => {
  const remaining = Math.max(0, (a.expected || 0) - (a.completed || 0));
  return (
    <Card
      className={cn(
        "rounded-2xl border-border cursor-pointer transition active:scale-[0.99]",
        muted ? "hover:border-border/80" : "hover:border-brand/50",
      )}
      onClick={() => onOpen(a.id)}
      data-testid={`assignment-card-${a.id}`}
    >
      <CardContent className="pt-5 pb-5">
        <p className="font-display text-2xl text-foreground">{a.station?.name}</p>
        <p className="text-sm text-muted-foreground">{(a.groups || []).map((g) => g.name).join(", ") || "All groups"}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-xs font-mono-num text-muted-foreground">
            {a.completed}/{a.expected} submitted{remaining > 0 ? ` · ${remaining} left` : " · done"}
          </p>
          <span className={cn("inline-flex items-center gap-1 text-sm font-semibold", muted ? "text-muted-foreground" : "text-brand")}>
            Open <ArrowRight className="h-4 w-4" />
          </span>
        </div>
        <ProgressBar done={a.completed} total={a.expected} muted={muted} />
      </CardContent>
    </Card>
  );
};

// One event in the top-level picker. Drills into its stations.
const EventCard = ({ g, onOpen }) => (
  <Card
    className={cn(
      "rounded-2xl border-border cursor-pointer transition active:scale-[0.99]",
      g.finished ? "hover:border-border/80" : "hover:border-brand/50",
    )}
    onClick={() => onOpen(g.key)}
    data-testid={`evaluate-event-${g.key}`}
  >
    <CardContent className="pt-5 pb-5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {eventDate(g.date) && <p className="text-xs text-muted-foreground uppercase tracking-widest">{eventDate(g.date)}</p>}
        {g.status && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {g.status}
          </span>
        )}
      </div>
      <p className="font-display text-2xl text-foreground mt-0.5 break-words">{g.name}</p>
      <p className="text-sm text-muted-foreground">
        {g.stations.length} {g.stations.length === 1 ? "station" : "stations"}
      </p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs font-mono-num text-muted-foreground">
          {g.completed}/{g.expected} submitted{g.remaining > 0 ? ` · ${g.remaining} left` : " · done"}
        </p>
        <span className={cn("inline-flex items-center gap-1 text-sm font-semibold", g.finished ? "text-muted-foreground" : "text-brand")}>
          Open <ArrowRight className="h-4 w-4" />
        </span>
      </div>
      <ProgressBar done={g.completed} total={g.expected} muted={g.finished} />
    </CardContent>
  </Card>
);

function isDone(status) {
  return ["submitted", "approved"].includes(status);
}
function isInProgress(status) {
  return ["draft", "returned"].includes(status);
}

/** Bib is the station-day identifier; jersey is shown too when the roster
 *  carries one and it differs. Safe when jersey_number is absent entirely. */
function idLabel(p) {
  const bib = p.bib_number;
  const jersey = p.jersey_number;
  if (bib && jersey && String(bib) !== String(jersey)) return `#${bib} · Jersey ${jersey}`;
  return `#${bib || jersey || "—"}`;
}

export default function Evaluate() {
  const { assignmentId, eventId } = useParams();
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
    // Warm the offline app shell as soon as an evaluator enters the flow, so a
    // cold reload later in the camp still boots. No-op if unsupported.
    registerAppShell();
    api.get("/my-assignments").then((r) => setAssignments(r.data))
      .catch((e) => { toast.error(errMsg(e)); setAssignments([]); });
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

  // The roster endpoint may or may not return jersey_number. Detect it rather
  // than assuming: search and labels adapt if it is present and are unaffected
  // if it is absent.
  const hasJersey = useMemo(
    () => (athletes || []).some((p) => p.jersey_number !== undefined && p.jersey_number !== null && p.jersey_number !== ""),
    [athletes],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const numeric = /^\d+$/.test(q);
    let list = (athletes || []).filter((p) => {
      if (filter === "todo" && isDone(p.evaluation_status)) return false;
      if (filter === "done" && !isDone(p.evaluation_status)) return false;
      if (!q) return true;
      const name = `${p.first_name || ""} ${p.last_name || ""}`.toLowerCase();
      const bib = String(p.bib_number ?? "").toLowerCase();
      const jersey = String(p.jersey_number ?? "").toLowerCase();
      // A digits-only query is almost always a bib/jersey number being called
      // out at the station — match those by prefix so "7" finds #7, not #17.
      if (numeric) return bib.startsWith(q) || jersey.startsWith(q) || name.includes(q);
      return name.includes(q) || bib.includes(q) || jersey.includes(q);
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

  // ---- Event picker, then stations within one event ----
  const eventGroups = useMemo(() => groupAssignmentsByEvent(assignments), [assignments]);

  if (!assignmentId) {
    if (!assignments) return <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>;

    // Drill-down: one event's stations.
    if (eventId) {
      const g = eventGroups.find((x) => x.key === eventId);
      if (!g) {
        return (
          <div className="space-y-4">
            <button onClick={() => navigate("/evaluate")} className="inline-flex items-center gap-1 text-sm text-info hover:underline min-h-[44px]" data-testid="back-to-events">
              <ArrowLeft className="h-3.5 w-3.5" /> All events
            </button>
            <EmptyState icon={ClipboardCheck} title="Event not found" hint="You have no station assignments for this event." />
          </div>
        );
      }
      return (
        <div className="space-y-4">
          <div>
            <button onClick={() => navigate("/evaluate")} className="inline-flex items-center gap-1 text-sm text-info hover:underline mb-1 min-h-[44px]" data-testid="back-to-events">
              <ArrowLeft className="h-3.5 w-3.5" /> All events
            </button>
            <h1 className="font-display text-3xl sm:text-4xl text-foreground break-words">{g.name}</h1>
            <p className="text-sm text-muted-foreground">
              {[eventDate(g.date), g.status, `${g.completed}/${g.expected} submitted`].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2" data-testid="evaluate-station-grid">
            {g.stations.map((a) => (
              <StationCard key={a.id} a={a} muted={g.finished} onOpen={(id) => navigate(`/evaluate/${id}`)} />
            ))}
          </div>
        </div>
      );
    }

    // Top level: events, live first.
    const live = eventGroups.filter((g) => !g.finished);
    const finished = eventGroups.filter((g) => g.finished);
    return (
      <div className="space-y-4">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl text-foreground">Evaluate</h1>
          <p className="text-sm text-muted-foreground">Pick your event, then your station.</p>
        </div>
        {eventGroups.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="No assignments" hint="You are not assigned to any station yet. Ask your administrator." />
        ) : (
          <>
            {live.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2" data-testid="evaluate-live-events">
                {live.map((g) => <EventCard key={g.key} g={g} onOpen={(id) => navigate(`/evaluate/event/${id}`)} />)}
              </div>
            )}

            {/* Finished events stay reachable — an evaluator still opens them to
                re-read past work — but they sit below anything still live and
                never dressed up as today's job. */}
            {finished.length > 0 && (
              <div className="space-y-2" data-testid="evaluate-finished-events">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground pt-1">
                  {live.length > 0 ? "Completed events" : `Completed events (${finished.length})`}
                </p>
                <div className="grid gap-3 md:grid-cols-2 opacity-70">
                  {finished.map((g) => <EventCard key={g.key} g={g} onOpen={(id) => navigate(`/evaluate/event/${id}`)} />)}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ---- Player list for assignment ----
  return (
    <div className="space-y-3">
      <div>
        <button
          onClick={() => navigate(assignment?.event_id ? `/evaluate/event/${assignment.event_id}` : "/evaluate")}
          className="inline-flex items-center gap-1 text-sm text-info hover:underline mb-1 min-h-[44px]"
          data-testid="back-to-assignments"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {assignment?.event?.name || "My assignments"}
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
              Next{nextTodo.bib_number ? ` · #${nextTodo.bib_number}` : ":"} {nextTodo.first_name} {nextTodo.last_name?.[0]}.
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
              inputMode="search"
              placeholder={hasJersey ? "Name, bib # or jersey #…" : "Name or bib #…"}
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
                "h-11 px-4 rounded-full text-xs font-semibold border transition active:scale-[0.97]",
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
                    <PlayerAvatar firstName={p.first_name} lastName={p.last_name} photoUrl={p.photo_url} bib={p.bib_number || p.jersey_number} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-foreground truncate">{p.first_name} {p.last_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {idLabel(p)} · {p.age_group || "—"} · {p.primary_position || "—"}
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
                  <PlayerAvatar firstName={p.first_name} lastName={p.last_name} photoUrl={p.photo_url} bib={p.bib_number || p.jersey_number} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground truncate">{p.first_name} {p.last_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {idLabel(p)} · {p.age_group || "—"} · {p.primary_position || "—"}
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
