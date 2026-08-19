import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, CalendarPlus, Check, Loader2, Plus, Search, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ProgramDetail() {
  const { programId } = useParams();
  const navigate = useNavigate();
  const [creatingEventFor, setCreatingEventFor] = useState(null);
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

  // Withdrawn rows stay in the API payload for history, but are not on the
  // roster — and their athletes must reappear in the enroll search (re-enrolling
  // revives the withdrawn row server-side).
  const activeEnrollments = useMemo(() => enrollments.filter((e) => e.status !== "withdrawn"), [enrollments]);

  const enrolledIds = useMemo(() => new Set(activeEnrollments.map((e) => e.athlete_id)), [activeEnrollments]);

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

  const removeAthlete = async (enrollment) => {
    const name = enrollment.athlete
      ? `${enrollment.athlete.first_name} ${enrollment.athlete.last_name}`
      : "this athlete";
    if (!window.confirm(`Remove ${name} from this program? Attendance history is kept and they can be re-enrolled.`)) return;
    try {
      await api.delete(`/programs/${programId}/enrollments/${enrollment.athlete_id}`);
      toast.success(`${name} removed from the program.`);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  // One tap: spin up the evaluation event for a session day (roster pre-filled
  // with everyone enrolled) and jump straight into the event dashboard.
  const createSessionEvent = async (s) => {
    setCreatingEventFor(s.id);
    try {
      const r = await api.post(`/programs/sessions/${s.id}/event`);
      const ev = r.data?.event;
      if (r.data?.created) {
        toast.success(`Event created${r.data.roster_added ? ` — ${r.data.roster_added} enrolled athletes added to the roster` : ""}.`);
      }
      if (ev?.id) navigate(`/events/${ev.id}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setCreatingEventFor(null);
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
          {prog.type} · {prog.status} · {activeEnrollments.length} enrolled
        </p>
        <p className="text-xs text-muted-foreground mt-2 max-w-lg">
          Camp flow: add session dates → enroll athletes → take attendance each session. Tap Create event on a session to run stations, check-in and scoring for that day — enrolled athletes are added to the event roster automatically.
        </p>
      </div>

      {/* Family enrollment: public link/QR into the registration wizard */}
      <Card className="rounded-2xl border-border bg-card" data-testid="program-enroll-share">
        <CardContent className="py-4 flex flex-wrap items-center gap-4">
          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(`${window.location.origin}/enroll/${programId}`)}`}
            alt="Enrollment QR"
            className="rounded-xl border border-border bg-white p-1.5 w-32 h-32"
            data-testid="program-enroll-qr"
          />
          <div className="flex-1 min-w-[200px] space-y-1.5">
            <p className="font-semibold text-foreground">Family enrollment</p>
            <p className="text-xs text-muted-foreground">
              Parents scan (or tap the link) to create the athlete&apos;s full 60&apos;6&quot; ID profile and enroll in
              this program — signed waivers included. Print the QR for the check-in table.
            </p>
            <p className="text-xs font-mono break-all text-info">{`${window.location.origin}/enroll/${programId}`}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs"
                onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/enroll/${programId}`); toast.success("Enrollment link copied."); }}
                data-testid="program-enroll-copy-link">
                Copy link
              </Button>
              <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs"
                onClick={() => window.open(`https://api.qrserver.com/v1/create-qr-code/?size=800x800&data=${encodeURIComponent(`${window.location.origin}/enroll/${programId}`)}`, "_blank")}
                data-testid="program-enroll-big-qr">
                Open big QR (print)
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

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
              <div
                key={s.id}
                role={s.event_id ? "button" : undefined}
                tabIndex={s.event_id ? 0 : undefined}
                onClick={s.event_id ? () => navigate(`/events/${s.event_id}`) : undefined}
                onKeyDown={s.event_id ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/events/${s.event_id}`); } } : undefined}
                className={cn(
                  "rounded-xl border border-border bg-card px-4 py-3 flex flex-wrap items-center justify-between gap-2 transition-colors",
                  s.event_id && "cursor-pointer hover:border-brand/50"
                )}
                data-testid={`session-row-${s.id}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">#{s.session_number} · {s.date}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[s.start_time && s.end_time ? `${s.start_time}–${s.end_time}` : null, s.focus || "No focus set", s.status]
                      .filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    className="rounded-xl h-10"
                    disabled={activeEnrollments.length === 0}
                    onClick={(e) => { e.stopPropagation(); openAttendance(s.id); }}
                    data-testid={`session-attendance-${s.id}`}
                  >
                    {activeSessionId === s.id ? "Taking attendance…" : "Attendance"}
                  </Button>
                  {s.event_id ? (
                    <Button
                      className="rounded-xl h-10 bg-brand hover:bg-brand-secondary"
                      onClick={(e) => { e.stopPropagation(); navigate(`/events/${s.event_id}`); }}
                      data-testid={`session-open-event-${s.id}`}
                    >
                      Open event <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      className="rounded-xl h-10 border-brand/40 text-brand hover:bg-brand-tertiary"
                      disabled={creatingEventFor === s.id}
                      onClick={(e) => { e.stopPropagation(); createSessionEvent(s); }}
                      data-testid={`session-create-event-${s.id}`}
                    >
                      {creatingEventFor === s.id
                        ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Creating…</>
                        : <><CalendarPlus className="h-4 w-4 mr-1" /> Create event</>}
                    </Button>
                  )}
                </div>
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
            {activeEnrollments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Enroll athletes first.</p>
            ) : (
              <div className="space-y-2">
                {activeEnrollments.map((e) => {
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
        <p className="font-semibold text-sm text-foreground mb-2">Roster ({activeEnrollments.length})</p>
        {activeEnrollments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody enrolled yet — search above and tap Enroll.</p>
        ) : (
          <div className="space-y-2">
            {activeEnrollments.map((e) => (
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
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs inline-flex items-center gap-1.5">
                    {e.status === "waitlisted" ? (
                      <span className="rounded-full bg-warning/15 text-warning font-semibold px-2 py-0.5">waitlisted</span>
                    ) : e.status === "pending" ? (
                      <span className="rounded-full bg-secondary text-muted-foreground font-semibold px-2 py-0.5">pending</span>
                    ) : (
                      <span className="text-muted-foreground inline-flex items-center gap-1">
                        <Check className="h-3.5 w-3.5 text-success" /> {e.status}
                      </span>
                    )}
                    {e.payment_status === "unpaid" && <span className="text-muted-foreground">· unpaid</span>}
                  </span>
                  <Button
                    variant="ghost"
                    className="h-8 rounded-lg px-2.5 text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => removeAthlete(e)}
                    data-testid={`program-remove-${e.athlete_id}`}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
