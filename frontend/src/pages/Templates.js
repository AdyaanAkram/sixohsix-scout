import { useEffect, useState } from "react";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { FileSpreadsheet, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const TYPE_LABELS = { rating_5: "1-5 Rating", rating_10: "1-10 Rating", numeric: "Numeric", time: "Time", velocity: "Velocity", yes_no: "Yes/No", multiple_choice: "Multiple Choice", comment: "Comment", observation: "Observation" };

export default function Templates() {
  const [templates, setTemplates] = useState(null);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    api.get("/templates").then((r) => setTemplates(r.data)).catch(() => setTemplates([]));
  }, []);

  if (!templates) return <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-4xl text-[#0B1E3A]">Evaluation Templates</h1>
        <p className="text-sm text-slate-500">Metric sets used by event stations. Weighted by category and metric.</p>
      </div>
      {templates.length === 0 ? (
        <EmptyState icon={FileSpreadsheet} title="No templates" hint="Templates define the metrics evaluators score at each station." />
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <Card key={t.id} className="rounded-2xl border-[#E7E1D6]">
              <CardContent className="py-4">
                <button className="w-full text-left flex items-center justify-between gap-2" onClick={() => setExpanded((x) => ({ ...x, [t.id]: !x[t.id] }))} data-testid={`template-toggle-${t.id}`}>
                  <div>
                    <p className="font-semibold text-[#0B1E3A]">{t.name}</p>
                    <p className="text-xs text-slate-500">{t.age_group || "All ages"} · {(t.metrics || []).length} metrics · {(t.categories || []).map((c) => `${c.name} ${c.weight}%`).join(" · ")}</p>
                  </div>
                  {expanded[t.id] ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                </button>
                {expanded[t.id] && (
                  <div className="mt-3 border-t pt-3 space-y-1.5">
                    {(t.metrics || []).sort((a, b) => (a.display_order || 0) - (b.display_order || 0)).map((m) => (
                      <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="font-medium text-slate-700">
                          {m.name} {m.required && <span className="text-[#C81D25]">*</span>}
                        </span>
                        <span className="text-xs text-slate-500">
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
