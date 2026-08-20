import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CalendarDays, CheckCircle2, ChevronRight, ClipboardCheck, ClipboardList, Clock, Undo2 } from "lucide-react";

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10) || null;
  const opts = { month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-US", opts);
};

const PanelLabel = ({ children }) => (
  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>
);

const StatTile = ({ icon: Icon, tint, value, label, testId }) => (
  <Card className="rounded-2xl border-border bg-card h-full" data-testid={testId}>
    <CardContent className="pt-4 pb-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
      <div className={cn("h-10 w-10 shrink-0 rounded-lg grid place-items-center", tint)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="font-mono-num text-2xl font-bold leading-none text-foreground">{value}</p>
        <p className="mt-1 text-xs font-semibold leading-snug text-foreground">{label}</p>
      </div>
    </CardContent>
  </Card>
);

/*
  Most evaluations in this org carry raw measurements with no normalized overall
  score, so a bare "—" would read as a broken record rather than a real state.
  Same wording as the review queue: submitted work says "Metrics recorded", a
  draft that has not been scored yet says so plainly.
*/
const ScoreChip = ({ score, status }) => {
  if (score !== null && score !== undefined) {
    return (
      <span className="rounded-lg bg-success/15 px-2.5 py-1 font-mono-num text-base font-bold leading-none text-success">
        {score}
      </span>
    );
  }
  return (
    <span className="rounded-lg bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground">
      {status === "draft" ? "Not scored yet" : "Metrics recorded"}
    </span>
  );
};

const EvalRow = ({ ev, eventName, onOpen }) => {
  const athlete = ev.athlete;
  const name = athlete ? `${athlete.first_name || ""} ${athlete.last_name || ""}`.trim() : "";
  const meta = [ev.station_name, eventName].filter(Boolean).join(" · ");
  const updated = fmtDate(ev.updated_at);

  return (
    <button
      className="w-full text-left"
      // A submitted evaluation opens its results summary; a draft reopens the form.
      onClick={onOpen}
      data-testid={`my-eval-${ev.id}`}
    >
      <Card className="rounded-2xl border-border transition-all hover:border-brand/50 hover:-translate-y-0.5">
        <CardContent className="p-3.5 sm:p-4">
          <div className="flex items-center gap-3">
            <PlayerAvatar
              firstName={athlete?.first_name}
              lastName={athlete?.last_name}
              photoUrl={athlete?.photo_url}
              size="sm"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{name || "Athlete"}</p>
              <p className="truncate text-xs text-muted-foreground">{meta || "No station recorded"}</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <ScoreChip score={ev.computed?.overall_score} status={ev.status} />
            {updated && (
              <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                <CalendarDays className="h-3 w-3 shrink-0" />
                <span className="truncate">Updated {updated}</span>
              </span>
            )}
            <span className="ml-auto shrink-0">
              <StatusBadge status={ev.status} />
            </span>
          </div>
        </CardContent>
      </Card>
    </button>
  );
};

export default function MyEvaluations() {
  const [evals, setEvals] = useState(null);
  const [failed, setFailed] = useState(false);
  const [eventNames, setEventNames] = useState({});
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/my-evaluations")
      .then((r) => setEvals(r.data))
      .catch(() => { setFailed(true); setEvals([]); });
  }, []);

  // /my-evaluations returns the raw evaluation docs, which carry event_id but no
  // event name. The name is a label only — if this lookup fails the rows simply
  // show the station on its own.
  useEffect(() => {
    api.get("/events")
      .then((r) => {
        const map = {};
        (r.data || []).forEach((e) => { map[e.id] = e.name; });
        setEventNames(map);
      })
      .catch(() => setEventNames({}));
  }, []);

  const header = (
    <div className="min-w-0">
      <h1 className="font-display text-3xl sm:text-4xl text-foreground">My Evaluations</h1>
      <p className="text-sm text-muted-foreground">Everything you have scored, newest first.</p>
    </div>
  );

  if (!evals) {
    return (
      <div className="space-y-4">
        {header}
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      </div>
    );
  }

  const drafts = evals.filter((e) => e.status === "draft").length;
  const submitted = evals.filter((e) => e.status === "submitted").length;
  const approved = evals.filter((e) => e.status === "approved").length;
  const returned = evals.filter((e) => e.status === "returned").length;

  return (
    <div className="space-y-4">
      {header}

      {evals.length > 0 && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-2" data-testid="my-evals-stat-row">
          <StatTile icon={Clock} tint="bg-warning/15 text-warning" value={drafts} label="Drafts" testId="my-evals-stat-drafts" />
          <StatTile icon={ClipboardCheck} tint="bg-brand/15 text-brand" value={submitted} label="Submitted" testId="my-evals-stat-submitted" />
          <StatTile icon={CheckCircle2} tint="bg-success/15 text-success" value={approved} label="Approved" testId="my-evals-stat-approved" />
          <StatTile icon={Undo2} tint="bg-destructive/15 text-destructive" value={returned} label="Returned" testId="my-evals-stat-returned" />
        </div>
      )}

      {failed ? (
        <EmptyState
          icon={ClipboardList}
          title="Could not load your evaluations"
          hint="Something went wrong fetching them. Refresh the page to try again."
        />
      ) : evals.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No evaluations yet" hint="Start scoring players from Evaluate in the sidebar." />
      ) : (
        <div className="space-y-3">
          <PanelLabel>{evals.length} {evals.length === 1 ? "evaluation" : "evaluations"}</PanelLabel>
          <div className="space-y-2">
            {evals.map((ev) => (
              <EvalRow
                key={ev.id}
                ev={ev}
                eventName={eventNames[ev.event_id]}
                onOpen={() => navigate(ev.status === "draft" ? `/evaluation/${ev.id}` : `/evaluation/${ev.id}/results`)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
