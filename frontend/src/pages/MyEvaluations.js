import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, ChevronRight } from "lucide-react";

export default function MyEvaluations() {
  const [evals, setEvals] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/my-evaluations").then((r) => setEvals(r.data)).catch(() => setEvals([]));
  }, []);

  if (!evals) return <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-4xl text-[#0B1E3A]">My Evaluations</h1>
        <p className="text-sm text-slate-500">{evals.filter((e) => e.status === "draft").length} drafts · {evals.filter((e) => e.status !== "draft").length} submitted</p>
      </div>
      {evals.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No evaluations yet" hint="Start scoring players from the Evaluate tab." />
      ) : (
        <div className="space-y-2">
          {evals.map((ev) => (
            <button key={ev.id} className="w-full text-left" onClick={() => navigate(`/evaluation/${ev.id}`)} data-testid={`my-eval-${ev.id}`}>
              <Card className="rounded-2xl border-[#E7E1D6] hover:bg-[hsl(var(--secondary))] transition">
                <CardContent className="py-3.5 flex items-center gap-3">
                  <PlayerAvatar firstName={ev.athlete?.first_name} lastName={ev.athlete?.last_name} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#0B1E3A] truncate">{ev.athlete?.first_name} {ev.athlete?.last_name}</p>
                    <p className="text-xs text-slate-500">{ev.station_name} · {(ev.updated_at || "").slice(0, 10)}</p>
                  </div>
                  {ev.computed?.overall_score != null && <span className="font-mono-num font-bold text-[#0B1E3A]">{ev.computed.overall_score}</span>}
                  <StatusBadge status={ev.status} />
                  <ChevronRight className="h-4 w-4 text-slate-300" />
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
