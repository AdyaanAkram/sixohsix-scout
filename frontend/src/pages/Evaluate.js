import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, ClipboardCheck, Search } from "lucide-react";

export default function Evaluate() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState(null);
  const [athletes, setAthletes] = useState(null);
  const [search, setSearch] = useState("");
  const [starting, setStarting] = useState(null);

  useEffect(() => {
    api.get("/my-assignments").then((r) => setAssignments(r.data));
  }, []);

  useEffect(() => {
    if (!assignmentId) { setAthletes(null); return; }
    api.get(`/my-assignments/${assignmentId}/athletes`).then((r) => setAthletes(r.data)).catch((e) => toast.error(errMsg(e)));
  }, [assignmentId]);

  const startEval = async (athleteId) => {
    setStarting(athleteId);
    try {
      const r = await api.post("/evaluations/start", { assignment_id: assignmentId, athlete_id: athleteId });
      navigate(`/evaluation/${r.data.id}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setStarting(null);
    }
  };

  // ---- Assignment picker ----
  if (!assignmentId) {
    if (!assignments) return <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>;
    return (
      <div className="space-y-4">
        <div>
          <h1 className="font-display text-4xl text-[#0B1E3A]">Evaluate</h1>
          <p className="text-sm text-slate-500">Select your station assignment to start scoring.</p>
        </div>
        {assignments.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="No assignments" hint="You are not assigned to any station yet. Ask your administrator." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {assignments.map((a) => (
              <Card key={a.id} className="rounded-2xl card-shadow border-[#E7E1D6] cursor-pointer hover:shadow-lg transition" onClick={() => navigate(`/evaluate/${a.id}`)} data-testid={`assignment-card-${a.id}`}>
                <CardContent className="pt-5 pb-5">
                  <p className="text-xs text-slate-400 uppercase tracking-widest">{a.event?.name}</p>
                  <p className="font-display text-2xl text-[#0B1E3A] mt-0.5">{a.station?.name}</p>
                  <p className="text-sm text-slate-500">{(a.groups || []).map((g) => g.name).join(", ") || "All groups"}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <p className="text-xs font-mono-num text-slate-600">{a.completed}/{a.expected} completed</p>
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-[#1F4AA8]">Open <ArrowRight className="h-4 w-4" /></span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ---- Player list for assignment ----
  const assignment = assignments?.find((a) => a.id === assignmentId);
  const filtered = (athletes || []).filter((p) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) || (p.bib_number || "").includes(q);
  });
  const done = (athletes || []).filter((p) => ["submitted", "approved"].includes(p.evaluation_status)).length;

  return (
    <div className="space-y-4">
      <div>
        <button onClick={() => navigate("/evaluate")} className="inline-flex items-center gap-1 text-sm text-[#1F4AA8] hover:underline mb-1" data-testid="back-to-assignments">
          <ArrowLeft className="h-3.5 w-3.5" /> My assignments
        </button>
        <h1 className="font-display text-3xl text-[#0B1E3A]">{assignment?.station?.name || "Station"}</h1>
        <p className="text-sm text-slate-500">{assignment?.event?.name} · {done}/{athletes?.length ?? "—"} players completed</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or bib #…" className="pl-9 h-12 rounded-xl bg-white" data-testid="evaluate-player-search" />
      </div>

      {!athletes ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Search} title="No players found" hint="Players appear here once they are checked in to the event and placed in your assigned group." />
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <button
              key={p.athlete_id}
              onClick={() => p.evaluation_id ? navigate(`/evaluation/${p.evaluation_id}`) : startEval(p.athlete_id)}
              disabled={starting === p.athlete_id}
              className="w-full text-left"
              data-testid={`evaluate-player-${p.athlete_id}`}
            >
              <Card className="rounded-2xl border-[#E7E1D6] hover:bg-[hsl(var(--secondary))] active:scale-[0.99] transition">
                <CardContent className="py-3.5 flex items-center gap-3">
                  <PlayerAvatar firstName={p.first_name} lastName={p.last_name} bib={p.bib_number} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#0B1E3A] truncate">{p.first_name} {p.last_name}</p>
                    <p className="text-xs text-slate-500">{p.age_group || "—"} · {p.primary_position || "—"} · {p.group_name || "No group"}</p>
                  </div>
                  <StatusBadge status={p.evaluation_status} />
                  <ArrowRight className="h-4 w-4 text-slate-300" />
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
