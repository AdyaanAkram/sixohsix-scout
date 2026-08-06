import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { CheckCircle2, Undo2, ClipboardList, AlertTriangle, ChevronDown, ChevronUp, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

const EvalDetail = ({ ev }) => {
  const metricMap = useMemo(() => {
    const m = {};
    (ev.template_metrics || []).forEach((x) => { m[x.id] = x; });
    return m;
  }, [ev]);
  const results = ev.computed?.metric_results || {};
  return (
    <div className="mt-3 border-t pt-3 space-y-1.5">
      {Object.entries(results).map(([mid, r]) => (
        <div key={mid} className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{metricMap[mid]?.name || ev.metric_names?.[mid] || mid.slice(0, 8)}</span>
          <span className="font-mono-num font-semibold">
            {r.not_observed ? "Not observed" : `${r.raw ?? "—"}${r.normalized !== null && r.normalized !== undefined ? ` → ${r.normalized}` : " (raw)"}`}
          </span>
        </div>
      ))}
      {ev.comments?.strengths && <p className="text-xs mt-2"><span className="font-semibold text-success">Strengths:</span> {ev.comments.strengths}</p>}
      {ev.comments?.development_needs && <p className="text-xs"><span className="font-semibold text-warning">Needs:</span> {ev.comments.development_needs}</p>}
      {(ev.comments?.quick_tags || []).length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">{ev.comments.quick_tags.map((t) => <span key={t} className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold">{t}</span>)}</div>
      )}
    </div>
  );
};

export default function ReviewQueue() {
  const { user } = useAuth();
  const [queue, setQueue] = useState(null);
  const [events, setEvents] = useState([]);
  const [eventFilter, setEventFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("submitted");
  const [expanded, setExpanded] = useState({});
  const [templates, setTemplates] = useState({});
  const [returnFor, setReturnFor] = useState(null);
  const [returnNote, setReturnNote] = useState("");
  const [disagreements, setDisagreements] = useState(null);

  const load = useCallback(() => {
    const params = {};
    if (eventFilter !== "all") params.event_id = eventFilter;
    api.get("/review/queue", { params }).then((r) => setQueue(r.data)).catch((e) => toast.error(errMsg(e)));
  }, [eventFilter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get("/events").then((r) => setEvents(r.data));
    api.get("/templates").then((r) => {
      const map = {};
      r.data.forEach((t) => t.metrics.forEach((m) => { map[m.id] = m; }));
      setTemplates(map);
    });
  }, []);
  useEffect(() => {
    if (eventFilter !== "all") {
      api.get(`/reports/disagreement/${eventFilter}`).then((r) => setDisagreements(r.data)).catch(() => setDisagreements(null));
    } else setDisagreements(null);
  }, [eventFilter]);

  const act = async (evId, action, note) => {
    try {
      await api.post(`/evaluations/${evId}/${action}`, { note: note || null });
      toast.success(action === "approve" ? "Evaluation approved." : "Returned to evaluator for revision.");
      setReturnFor(null);
      setReturnNote("");
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!queue) return <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>;

  const filtered = queue.filter((q) => statusFilter === "all" || q.status === statusFilter);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-4xl text-foreground">Review Queue</h1>
        <p className="text-sm text-muted-foreground">{queue.filter((q) => q.status === "submitted").length} evaluations awaiting review</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={eventFilter} onValueChange={setEventFilter}>
          <SelectTrigger className="w-[220px] h-11 rounded-xl bg-card" data-testid="review-event-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All events</SelectItem>{events.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px] h-11 rounded-xl bg-card" data-testid="review-status-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {disagreements && disagreements.length > 0 && (
        <Card className="rounded-2xl border-warning/40 bg-warning/15/60">
          <CardContent className="py-4">
            <p className="font-semibold text-sm text-warning flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Evaluator disagreements (largest spread first)</p>
            <div className="mt-2 space-y-1.5">
              {disagreements.slice(0, 5).map((d, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span>{d.athlete?.first_name} {d.athlete?.last_name} · {d.station_name}</span>
                  <span className="font-mono-num font-semibold">spread {d.spread} ({d.scores.map((s) => s.score).join(" vs ")})</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {filtered.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Queue is clear" hint="Submitted evaluations will appear here for review and approval." />
      ) : (
        <div className="space-y-2">
          {filtered.map((ev) => (
            <Card key={ev.id} className="rounded-2xl border-border" data-testid={`review-item-${ev.id}`}>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <PlayerAvatar firstName={ev.athlete?.first_name} lastName={ev.athlete?.last_name} size="sm" />
                  <div className="flex-1 min-w-0">
                    <Link to={`/players/${ev.athlete_id}`} className="text-sm font-semibold text-foreground hover:underline">
                      {ev.athlete?.first_name} {ev.athlete?.last_name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{ev.station_name} · {ev.event_name} · by {ev.evaluator_name}</p>
                  </div>
                  <p className="font-mono-num font-bold text-lg text-foreground">{ev.computed?.overall_score ?? "—"}</p>
                  <StatusBadge status={ev.status} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setExpanded((x) => ({ ...x, [ev.id]: !x[ev.id] }))}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-info"
                    data-testid={`review-expand-${ev.id}`}
                  >
                    {expanded[ev.id] ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} {expanded[ev.id] ? "Hide detail" : "View detail"}
                  </button>
                  <Link
                    to={`/evaluation/${ev.id}/results`}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-brand"
                    data-testid={`review-results-${ev.id}`}
                  >
                    <BarChart3 className="h-3.5 w-3.5" /> Results summary
                  </Link>
                  <div className="flex-1" />
                  {ev.status === "submitted" && (
                    <>
                      <Button size="sm" variant="outline" className="rounded-lg h-9" onClick={() => setReturnFor(ev)} data-testid="review-return-button">
                        <Undo2 className="h-3.5 w-3.5 mr-1" /> Return
                      </Button>
                      <Button size="sm" className="rounded-lg h-9 bg-success hover:bg-[hsl(var(--success))]" onClick={() => act(ev.id, "approve")} data-testid="review-approve-button">
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                      </Button>
                    </>
                  )}
                </div>
                {expanded[ev.id] && <EvalDetail ev={{ ...ev, template_metrics: Object.values(templates).filter((m) => (ev.computed?.metric_results || {})[m.id]) }} />}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!returnFor} onOpenChange={(v) => !v && setReturnFor(null)}>
        <DialogContent className="rounded-2xl max-w-sm">
          <DialogHeader><DialogTitle className="font-display text-2xl text-foreground">Return for Revision</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">The evaluation will be unlocked and sent back to {returnFor?.evaluator_name}. Add a note explaining what needs revision.</p>
          <Textarea value={returnNote} onChange={(e) => setReturnNote(e.target.value)} rows={3} className="rounded-xl" placeholder="Reason for return…" data-testid="review-return-reason-textarea" />
          <DialogFooter>
            <Button className="w-full rounded-xl bg-primary h-11" onClick={() => act(returnFor.id, "return", returnNote)} disabled={!returnNote.trim()} data-testid="review-return-confirm">Return Evaluation</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
