import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { toast } from "sonner";
import { ArrowLeft, Check, Loader2, Plus, Search, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ProgramDetail() {
  const { programId } = useParams();
  const [prog, setProg] = useState(null);
  const [enrollments, setEnrollments] = useState([]);
  const [sessionDate, setSessionDate] = useState("");
  const [sessionFocus, setSessionFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [enrollQ, setEnrollQ] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [enrollingId, setEnrollingId] = useState(null);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const searchTimer = useRef(null);

  const load = useCallback(() => {
    api.get(`/programs/${programId}`).then((r) => setProg(r.data)).catch((e) => toast.error(errMsg(e)));
    api.get(`/programs/${programId}/enrollments`).then((r) => setEnrollments(r.data)).catch(() => setEnrollments([]));
  }, [programId]);
  useEffect(() => { load(); }, [load]);

  const enrolledIds = useMemo(() => new Set(enrollments.map((e) => e.athlete_id)), [enrollments]);

  const searchAthletes = useCallback(async (q) => {
    setSearchBusy(true);
    try {
      const r = await api.get("/athletes", { params: { search: q || undefined, status: "active", limit: 30 } });
      const rows = Array.isArray(r.data) ? r.data : [];
      setCandidates(rows.filter((a) => !enrolledIds.has(a.id)));
    } catch (e) {
      toast.error(errMsg(e));
      setCandidates([]);
    } finally {
      setSearchBusy(false);
    }
  }, [enrolledIds]);

  useEffect(() => {
    // Initial suggestions when opening enroll (empty query = recent/active list)
    void searchAthletes("");
  }, [searchAthletes]);

  const onEnrollSearch = (q) => {
    setEnrollQ(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => searchAthletes(q), 300);
  };

  const addSession = async () => {
    if (!sessionDate) return;
    setBusy(true);
    try {
      await api.post(`/programs/${programId}/sessions`, { date: sessionDate, focus: sessionFocus || null });
      toast.success("Session added.");
      setSessionDate("");
      setSessionFocus("");
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const enroll = async (athleteId) => {
    setEnrollingId(athleteId);
    try {
      await api.post(`/programs/${programId}/enrollments`, {
        athlete_id: athleteId,
        status: "enrolled",
        payment_status: "unpaid",
        source: "staff",
      });
      toast.success("Athlete enrolled.");
      setCandidates((prev) => prev.filter((a) => a.id !== athleteId));
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setEnrollingId(null);
    }
  };

  const openAttendance = async (sessionId) => {
    setActiveSessionId(sessionId);
    try {
      const r = await api.get(`/programs/sessions/${sessionId}/attendance`);
      setAttendance(r.data || []);
    } catch {
      setAttendance([]);
    }
  };

  const markAttendance = async (athleteId, status) => {
    if (!activeSessionId) return;
    try {
      await api.post(`/programs/sessions/${activeSessionId}/attendance`, { athlete_id: athleteId, status });
      setAttendance((prev) => {
        const rest = prev.filter((a) => a.athlete_id !== athleteId);
        return [...rest, { athlete_id: athleteId, status }];
      });
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const attendanceMap = useMemo(() => {
    const m = {};
    for (const a of attendance) m[a.athlete_id] = a.status;
    return m;
  }, [attendance]);

  if (!prog) return <Skeleton className="h-40 rounded-2xl" />;

  return (
    <div className="space-y-5 max-w-3xl" data-testid="program-detail-page">
      <div>
        <Link to="/programs" className="inline-flex items-center gap-1 text-sm text-info hover:underline mb-2">
          <ArrowLeft className="h-3.5 w-3.5" /> Programs
        </Link>
        <h1 className="font-display text-4xl text-foreground">{prog.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {prog.type} · {prog.status} · {enrollments.length} enrolled
        </p>
        <p className="text-xs text-muted-foreground mt-2 max-w-lg">
          Camp flow: add session dates → enroll athletes → take attendance each session. Evaluation events stay separate under Events.
        </p>
      </div>

      {/* 1. Sessions */}
      <Card className="rounded-2xl border-border bg-card">
        <CardContent className="pt-4 pb-4 space-y-3">
          <p className="font-semibold text-sm text-foreground">1. Add session dates</p>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="space-y-1"><Label className="text-xs">Date</Label>
              <Input type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} className="h-11 rounded-lg w-44" data-testid="session-date-input" />
            </div>
            <div className="space-y-1 flex-1 min-w-[160px]"><Label className="text-xs">Focus (optional)</Label>
              <Input value={sessionFocus} onChange={(e) => setSessionFocus(e.target.value)} className="h-11 rounded-lg" placeholder="Hitting, defense…" data-testid="session-focus-input" />
            </div>
            <Button onClick={addSession} disabled={busy || !sessionDate} className="rounded-xl bg-brand h-11" data-testid="session-add-button">
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <div>
        <p className="font-semibold text-sm text-foreground mb-2">Sessions ({(prog.sessions || []).length})</p>
        {(prog.sessions || []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No sessions yet — add the first date above.</p>
        ) : (
          <div className="space-y-2">
            {prog.sessions.map((s) => (
              <div key={s.id} className="rounded-xl border border-border bg-card px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">#{s.session_number} · {s.date}</p>
                  <p className="text-xs text-muted-foreground">{s.focus || "No focus set"} · {s.status}</p>
                </div>
                <Button
                  variant="outline"
                  className="rounded-xl h-10"
                  disabled={enrollments.length === 0}
                  onClick={() => openAttendance(s.id)}
                  data-testid={`session-attendance-${s.id}`}
                >
                  {activeSessionId === s.id ? "Taking attendance…" : "Attendance"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Attendance panel */}
      {activeSessionId && (
        <Card className="rounded-2xl border-brand/40 bg-brand-tertiary" data-testid="attendance-panel">
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-sm text-foreground">Session attendance</p>
              <Button variant="ghost" className="h-8 text-xs" onClick={() => setActiveSessionId(null)}>Close</Button>
            </div>
            {enrollments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Enroll athletes first.</p>
            ) : (
              <div className="space-y-2">
                {enrollments.map((e) => {
                  const st = attendanceMap[e.athlete_id];
                  return (
                    <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card border border-border px-3 py-2.5">
                      <span className="text-sm font-medium text-foreground">
                        {e.athlete ? `${e.athlete.first_name} ${e.athlete.last_name}` : e.athlete_id}
                      </span>
                      <div className="flex gap-1.5">
                        {["present", "late", "absent", "excused"].map((status) => (
                          <button
                            key={status}
                            type="button"
                            onClick={() => markAttendance(e.athlete_id, status)}
                            className={cn(
                              "h-9 px-2.5 rounded-lg text-[11px] font-semibold border capitalize",
                              st === status
                                ? "bg-brand text-primary-foreground border-brand"
                                : "bg-secondary text-muted-foreground border-border"
                            )}
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 2. Enroll */}
      <Card className="rounded-2xl border-border bg-card">
        <CardContent className="pt-4 pb-4 space-y-3">
          <p className="font-semibold text-sm text-foreground flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-brand" /> 2. Enroll athletes
          </p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={enrollQ}
              onChange={(e) => onEnrollSearch(e.target.value)}
              placeholder="Search players by name…"
              className="pl-9 h-12 rounded-xl"
              data-testid="program-enroll-search"
            />
          </div>
          <div className="max-h-56 overflow-y-auto space-y-1.5 min-h-[3rem]">
            {searchBusy && candidates.length === 0 ? (
              <Skeleton className="h-14 rounded-xl" />
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {enrollQ ? "No matching players left to enroll." : "All shown players are already enrolled, or add players under Players first."}
              </p>
            ) : (
              candidates.slice(0, 20).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  disabled={enrollingId === a.id}
                  onClick={() => enroll(a.id)}
                  className="w-full text-left rounded-xl border border-border bg-background px-3 py-2.5 flex items-center gap-3 hover:bg-secondary min-h-[52px]"
                  data-testid={`enroll-athlete-${a.id}`}
                >
                  <PlayerAvatar firstName={a.first_name} lastName={a.last_name} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{a.first_name} {a.last_name}</p>
                    <p className="text-xs text-muted-foreground">{a.age_group || "—"} · {a.primary_position || "—"}</p>
                  </div>
                  {enrollingId === a.id ? (
                    <Loader2 className="h-4 w-4 animate-spin text-brand" />
                  ) : (
                    <span className="text-xs font-semibold text-brand inline-flex items-center gap-1"><Plus className="h-3.5 w-3.5" /> Enroll</span>
                  )}
                </button>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <div>
        <p className="font-semibold text-sm text-foreground mb-2">Roster ({enrollments.length})</p>
        {enrollments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody enrolled yet — search above and tap Enroll.</p>
        ) : (
          <div className="space-y-2">
            {enrollments.map((e) => (
              <div key={e.id} className="rounded-xl border border-border bg-card px-4 py-3 text-sm flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <PlayerAvatar
                    firstName={e.athlete?.first_name}
                    lastName={e.athlete?.last_name}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">
                      {e.athlete ? `${e.athlete.first_name} ${e.athlete.last_name}` : e.athlete_id}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {e.athlete?.age_group || "—"} · {e.athlete?.primary_position || "—"}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1 shrink-0">
                  <Check className="h-3.5 w-3.5 text-success" /> {e.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
