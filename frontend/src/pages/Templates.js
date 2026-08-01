import { useEffect, useMemo, useState } from "react";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { FileSpreadsheet, ChevronDown, ChevronUp, AlertTriangle, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { POSITIONS } from "@/lib/templateCache";

const TYPE_LABELS = { rating_5: "1-5 Rating", rating_10: "1-10 Rating", numeric: "Numeric", time: "Time", velocity: "Velocity", yes_no: "Yes/No", multiple_choice: "Multiple Choice", comment: "Comment", observation: "Observation" };

export default function Templates() {
  const { user } = useAuth();
  const canEdit = ["owner", "admin"].includes(user?.role);
  const [templates, setTemplates] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [savingId, setSavingId] = useState(null);

  const load = () => api.get("/templates").then((r) => setTemplates(r.data)).catch(() => setTemplates([]));
  useEffect(() => { load(); }, []);

  const positionConflicts = useMemo(() => {
    const claimed = {};
    for (const t of templates || []) {
      for (const p of t.applies_to_positions || []) {
        claimed[p] = claimed[p] || [];
        claimed[p].push(t.name);
      }
    }
    return Object.entries(claimed).filter(([, names]) => names.length > 1);
  }, [templates]);

  const togglePosition = async (t, pos) => {
    if (!canEdit) return;
    const current = new Set(t.applies_to_positions || []);
    if (current.has(pos)) current.delete(pos);
    else current.add(pos);
    const next = [...current];
    // warn client-side if another template already claims pos
    const clash = (templates || []).find((x) => x.id !== t.id && (x.applies_to_positions || []).includes(pos));
    if (clash && next.includes(pos)) {
      toast.warning(`${pos} is already claimed by “${clash.name}”. Save anyway only if intentional.`);
    }
    setSavingId(t.id);
    try {
      await api.put(`/templates/${t.id}`, {
        name: t.name,
        description: t.description,
        age_group: t.age_group,
        position: t.position,
        event_type: t.event_type,
        categories: t.categories || [],
        metrics: t.metrics || [],
        applies_to_positions: next,
        is_default: !!t.is_default,
      });
      toast.success("Template positions updated.");
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSavingId(null);
    }
  };

  const setDefault = async (t) => {
    if (!canEdit) return;
    setSavingId(t.id);
    try {
      await api.put(`/templates/${t.id}`, {
        name: t.name,
        description: t.description,
        age_group: t.age_group,
        position: t.position,
        event_type: t.event_type,
        categories: t.categories || [],
        metrics: t.metrics || [],
        applies_to_positions: t.applies_to_positions || [],
        is_default: true,
      });
      toast.success(`“${t.name}” is now the org default catch-all.`);
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSavingId(null);
    }
  };

  if (!templates) return <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-4xl text-foreground">Evaluation Templates</h1>
        <p className="text-sm text-muted-foreground">Metric sets resolved by athlete position, then station, then org default.</p>
      </div>

      {positionConflicts.length > 0 && (
        <div className="rounded-xl bg-warning/15 border border-warning/40 px-4 py-3 text-sm text-warning flex items-start gap-2" data-testid="position-conflict-warning">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Overlapping position claims</p>
            <ul className="mt-1 space-y-0.5">
              {positionConflicts.map(([pos, names]) => (
                <li key={pos}><span className="font-mono font-bold">{pos}</span>: {names.join(" · ")}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {templates.length === 0 ? (
        <EmptyState icon={FileSpreadsheet} title="No templates" hint="Templates define the metrics evaluators score at each station." />
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <Card key={t.id} className="rounded-2xl border-border">
              <CardContent className="py-4">
                <button className="w-full text-left flex items-center justify-between gap-2" onClick={() => setExpanded((x) => ({ ...x, [t.id]: !x[t.id] }))} data-testid={`template-toggle-${t.id}`}>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-foreground">{t.name}</p>
                      {t.is_default && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 border border-warning/40 text-warning px-2 py-0.5 text-[10px] font-bold uppercase" data-testid={`template-default-${t.id}`}>
                          <Star className="h-3 w-3" /> Org default
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t.age_group || "All ages"} · {(t.metrics || []).length} metrics
                      {(t.applies_to_positions || []).length > 0
                        ? ` · positions ${(t.applies_to_positions || []).join(", ")}`
                        : " · universal / station fallback"}
                      {t.template_version ? ` · v${t.template_version}` : ""}
                    </p>
                  </div>
                  {expanded[t.id] ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </button>
                {expanded[t.id] && (
                  <div className="mt-3 border-t pt-3 space-y-3">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Applies to positions</p>
                      <div className="flex flex-wrap gap-1.5">
                        {POSITIONS.map((p) => {
                          const on = (t.applies_to_positions || []).includes(p);
                          return (
                            <button
                              key={p}
                              type="button"
                              disabled={!canEdit || savingId === t.id}
                              onClick={() => togglePosition(t, p)}
                              className={cn(
                                "rounded-lg border px-2.5 h-8 text-xs font-bold transition",
                                on ? "bg-primary text-white border-transparent" : "bg-card text-muted-foreground hover:bg-secondary"
                              )}
                              data-testid={`template-pos-${t.id}-${p}`}
                            >
                              {p}
                            </button>
                          );
                        })}
                      </div>
                      {canEdit && !t.is_default && (
                        <Button variant="outline" size="sm" className="mt-2 rounded-lg h-8 text-xs" disabled={savingId === t.id} onClick={() => setDefault(t)} data-testid={`template-set-default-${t.id}`}>
                          Set as org default
                        </Button>
                      )}
                    </div>
                    {(t.metrics || []).sort((a, b) => (a.display_order || 0) - (b.display_order || 0)).map((m) => (
                      <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="font-medium text-foreground">
                          {m.name} {m.required && <span className="text-destructive">*</span>}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {m.category} · {TYPE_LABELS[m.metric_type]} {m.unit && `(${m.unit})`} · weight {m.weight}
                          {["time"].includes(m.metric_type) || m.higher_is_better === false ? " · lower is better" : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
