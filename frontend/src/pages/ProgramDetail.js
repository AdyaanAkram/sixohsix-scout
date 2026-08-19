import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, CalendarDays, CalendarPlus, Check, Clock, DollarSign, Loader2, Pencil, Plus, Search, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ---------------------------------- helpers ---------------------------------- */

const todayISO = () => new Date().toISOString().slice(0, 10);

const fmtPrice = (cents) => {
  const dollars = (cents || 0) / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
};

const fullName = (a, fallback) => (a ? `${a.first_name} ${a.last_name}` : fallback);

const MARKS = ["present", "late", "absent", "excused"];

/* Mirrors PROGRAM_TYPES / PROGRAM_STATUSES on the backend — anything else is a
   422 from PATCH /programs/{id}. Labels match the Programs list page. */
const PROGRAM_TYPES = [
  { value: "camp", label: "Camp" },
  { value: "clinic", label: "Clinic" },
  { value: "training_block", label: "Training block" },
  { value: "coaching_clinic", label: "Coaching clinic" },
];

const PROGRAM_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const EDIT_ROLES = ["owner", "admin", "head_scout", "coach"];

/* --------------------------------- primitives -------------------------------- */

const PanelLabel = ({ children }) => (
  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>
);

const StatTile = ({ icon: Icon, tint, value, label, sub }) => (
  <div className="flex items-center gap-3 rounded-xl px-3 py-2">
    <span className={cn("h-10 w-10 rounded-lg grid place-items-center shrink-0", tint)}>
      <Icon className="h-5 w-5" />
    </span>
    <div className="min-w-0">
      <p className="font-mono-num font-bold text-2xl leading-none text-foreground">{value ?? "—"}</p>
      <p className="mt-1 text-[11px] font-semibold text-foreground">{label}</p>
      {sub && <p className="text-[10px] text-muted-foreground truncate">{sub}</p>}
    </div>
  </div>
);

/* Module-level so React never remounts them — an inline component definition
   rebuilds the <Input> every keystroke and the field loses focus. */
const AddSessionForm = ({ date, focus, onDateChange, onFocusChange, onAdd, busy }) => (
  <div className="flex flex-wrap gap-2 items-end rounded-xl border border-border bg-background px-3 py-3">
    <div className="space-y-1">
      <Label className="text-xs">Date</Label>
      <Input
        type="date"
        value={date}
        onChange={(e) => onDateChange(e.target.value)}
        className="h-11 rounded-lg w-44"
        data-testid="session-date-input"
      />
    </div>
    <div className="space-y-1 flex-1 min-w-[160px]">
      <Label className="text-xs">Focus (optional)</Label>
      <Input
        value={focus}
        onChange={(e) => onFocusChange(e.target.value)}
        className="h-11 rounded-lg"
        placeholder="Hitting, defense…"
        data-testid="session-focus-input"
      />
    </div>
    <Button onClick={onAdd} disabled={busy || !date} className="rounded-xl bg-brand h-11" data-testid="session-add-button">
      <Plus className="h-4 w-4 mr-1" /> Add
    </Button>
  </div>
);

const EnrollSearch = ({ query, onQueryChange, searchBusy, candidates, enrollingId, onEnroll }) => (
  <div className="space-y-2 rounded-xl border border-border bg-background px-3 py-3">
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search players by name…"
        className="pl-9 h-11 rounded-xl"
        data-testid="program-enroll-search"
      />
    </div>
    <div className="max-h-56 overflow-y-auto space-y-1.5 min-h-[3rem]">
      {searchBusy && candidates.length === 0 ? (
        <Skeleton className="h-14 rounded-xl" />
      ) : candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          {query ? "No matching players left to enroll." : "All shown players are already enrolled, or add players under Players first."}
        </p>
      ) : (
        candidates.slice(0, 20).map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={enrollingId === a.id}
            onClick={() => onEnroll(a.id)}
            className="w-full text-left rounded-xl border border-border bg-card px-3 py-2.5 flex items-center gap-3 hover:bg-secondary min-h-[52px]"
            data-testid={`enroll-athlete-${a.id}`}
          >
            <PlayerAvatar firstName={a.first_name} lastName={a.last_name} photoUrl={a.photo_url} size="sm" />
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
  </div>
);

/* Module level for the same reason as the forms above: an inline definition
   remounts every <Input> on each keystroke and the field loses focus. */
const EditProgramForm = ({ form, onField }) => (
  <div className="space-y-3">
    <div className="space-y-1">
      <Label className="text-xs">Name</Label>
      <Input
        value={form.name}
        onChange={(e) => onField("name", e.target.value)}
        className="h-10 rounded-lg"
        data-testid="program-edit-name"
      />
    </div>
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label className="text-xs">Type</Label>
        <Select value={form.type} onValueChange={(v) => onField("type", v)}>
          <SelectTrigger className="h-10 rounded-lg" data-testid="program-edit-type"><SelectValue /></SelectTrigger>
          <SelectContent>
            {!PROGRAM_TYPES.some((t) => t.value === form.type) && form.type && (
              <SelectItem value={form.type}>{form.type}</SelectItem>
            )}
            {PROGRAM_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Status</Label>
        <Select value={form.status} onValueChange={(v) => onField("status", v)}>
          <SelectTrigger className="h-10 rounded-lg" data-testid="program-edit-status"><SelectValue /></SelectTrigger>
          <SelectContent>
            {!PROGRAM_STATUSES.some((s) => s.value === form.status) && form.status && (
              <SelectItem value={form.status}>{form.status}</SelectItem>
            )}
            {PROGRAM_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label className="text-xs">Start date</Label>
        <Input
          type="date"
          value={form.start_date}
          onChange={(e) => onField("start_date", e.target.value)}
          className="h-10 rounded-lg"
          data-testid="program-edit-start_date"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">End date</Label>
        <Input
          type="date"
          value={form.end_date}
          onChange={(e) => onField("end_date", e.target.value)}
          className="h-10 rounded-lg"
          data-testid="program-edit-end_date"
        />
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label className="text-xs">Capacity</Label>
        <Input
          type="number"
          min="1"
          max="5000"
          value={form.capacity}
          onChange={(e) => onField("capacity", e.target.value)}
          placeholder="No limit"
          className="h-10 rounded-lg"
          data-testid="program-edit-capacity"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Price (USD)</Label>
        <Input
          type="number"
          min="0"
          step="0.01"
          value={form.price}
          onChange={(e) => onField("price", e.target.value)}
          placeholder="Free"
          className="h-10 rounded-lg"
          data-testid="program-edit-price_cents"
        />
      </div>
    </div>
    <div className="space-y-1">
      <Label className="text-xs">Description</Label>
      <Input
        value={form.description}
        onChange={(e) => onField("description", e.target.value)}
        className="h-10 rounded-lg"
        data-testid="program-edit-description"
      />
    </div>
  </div>
);

/* ----------------------------------- page ------------------------------------ */

export default function ProgramDetail() {
  const { programId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [creatingEventFor, setCreatingEventFor] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "", type: "camp", status: "draft", start_date: "", end_date: "",
    capacity: "", price: "", description: "",
  });
  const [prog, setProg] = useState(null);
  const [enrollments, setEnrollments] = useState([]);
  const [sessionDate, setSessionDate] = useState("");
  const [sessionFocus, setSessionFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAddSession, setShowAddSession] = useState(false);
  const [showEnroll, setShowEnroll] = useState(false);
  const [enrollQ, setEnrollQ] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [enrollingId, setEnrollingId] = useState(null);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [roster, setRoster] = useState(null);
  const [rosterBusy, setRosterBusy] = useState(false);
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

  const sessions = useMemo(() => prog?.sessions || [], [prog]);

  const upcomingCount = useMemo(() => {
    const t = todayISO();
    return sessions.filter((s) => (s.date || "") >= t).length;
  }, [sessions]);

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

  const onEnrollSearch = useCallback((q) => {
    setEnrollQ(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => searchAthletes(q), 300);
  }, [searchAthletes]);

  const canEdit = EDIT_ROLES.includes(user?.role);

  const onEditField = useCallback((field, value) => {
    setEditForm((f) => ({ ...f, [field]: value }));
  }, []);

  const openEditProgram = () => {
    setEditForm({
      name: prog?.name || "",
      type: prog?.type || "camp",
      status: prog?.status || "draft",
      start_date: prog?.start_date || "",
      end_date: prog?.end_date || "",
      capacity: prog?.capacity == null ? "" : String(prog.capacity),
      price: prog?.price_cents == null ? "" : String(prog.price_cents / 100),
      description: prog?.description || "",
    });
    setEditOpen(true);
  };

  // Only the fields this dialog owns are sent — ProgramPatch forbids unknown
  // keys, and omitting age_groups/location_id leaves them untouched server-side.
  const saveEditProgram = async () => {
    const capacity = editForm.capacity === "" ? null : Number.parseInt(editForm.capacity, 10);
    const priceCents = editForm.price === "" ? null : Math.round(Number.parseFloat(editForm.price) * 100);
    setEditBusy(true);
    try {
      await api.patch(`/programs/${programId}`, {
        name: editForm.name.trim(),
        type: editForm.type,
        status: editForm.status,
        start_date: editForm.start_date || null,
        end_date: editForm.end_date || null,
        capacity: Number.isFinite(capacity) ? capacity : null,
        price_cents: Number.isFinite(priceCents) ? priceCents : null,
        description: editForm.description.trim() || null,
      });
      toast.success("Program updated.");
      setEditOpen(false);
      load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setEditBusy(false);
    }
  };

  const addSession = async () => {
    if (!sessionDate) return;
    setBusy(true);
    try {
      await api.post(`/programs/${programId}/sessions`, { date: sessionDate, focus: sessionFocus || null });
      toast.success("Session added.");
      setSessionDate("");
      setSessionFocus("");
      setShowAddSession(false);
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
    const name = fullName(enrollment.athlete, "this athlete");
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

  // The session roster endpoint is the single source of truth for who is
  // expected: when the session has a linked event, the event roster wins (that
  // is where walk-ups get added and no-shows removed on the day). It also
  // carries each athlete's saved mark, so no separate attendance GET is needed.
  const openAttendance = async (sessionId) => {
    setActiveSessionId(sessionId);
    setRoster(null);
    setAttendance([]);
    setRosterBusy(true);
    try {
      const r = await api.get(`/programs/sessions/${sessionId}/roster`);
      const data = r.data || {};
      const rows = Array.isArray(data.athletes) ? data.athletes : [];
      setRoster({ source: data.source || "program", event_id: data.event_id || null, athletes: rows });
      setAttendance(rows.filter((a) => a.attendance).map((a) => ({ athlete_id: a.athlete_id, status: a.attendance })));
    } catch (e) {
      toast.error(errMsg(e));
      setRoster({ source: "program", event_id: null, athletes: [] });
      setAttendance([]);
    } finally {
      setRosterBusy(false);
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

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || null,
    [sessions, activeSessionId]
  );

  const enrollLink = `${window.location.origin}/enroll/${programId}`;

  if (!prog) return <Skeleton className="h-40 rounded-2xl" />;

  return (
    <div className="space-y-4 max-w-6xl" data-testid="program-detail-page">
      {/* Header */}
      <div>
        <Link to="/programs" className="inline-flex items-center gap-1 text-sm text-info hover:underline mb-2">
          <ArrowLeft className="h-3.5 w-3.5" /> Programs
        </Link>
        <span className="flex items-center gap-2">
          <h1 className="font-display text-3xl sm:text-4xl text-foreground">{prog.name}</h1>
          {canEdit && (
            <button
              type="button"
              onClick={openEditProgram}
              className="text-muted-foreground hover:text-foreground p-1"
              title="Edit program details"
              data-testid="program-edit-button"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
        </span>
        <p className="text-sm text-muted-foreground mt-1">
          {prog.type} · {prog.status} · {activeEnrollments.length} enrolled
        </p>
        <p className="text-xs text-muted-foreground mt-2 max-w-xl">
          Take attendance each session. Create a session&apos;s event to run stations, check-in and scoring for that day — enrolled athletes join the event roster automatically.
        </p>
      </div>

      {canEdit && (
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="rounded-2xl max-w-md" data-testid="program-edit-dialog">
            <DialogHeader><DialogTitle className="font-display text-2xl text-foreground">Edit program</DialogTitle></DialogHeader>
            <EditProgramForm form={editForm} onField={onEditField} />
            <DialogFooter>
              <Button
                onClick={saveEditProgram}
                disabled={editBusy || !editForm.name.trim()}
                className="w-full rounded-xl bg-primary h-11"
                data-testid="program-edit-save"
              >
                {editBusy ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Saving…</> : "Save program"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Snapshot band */}
      <Card className="rounded-2xl border-border bg-card" data-testid="program-snapshot">
        <CardContent className="pt-4 pb-4">
          <PanelLabel>Program snapshot</PanelLabel>
          <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
            <StatTile
              icon={CalendarDays}
              tint="bg-brand/15 text-brand"
              value={sessions.length}
              label="Sessions"
              sub={sessions.length === 0 ? "none scheduled" : "scheduled"}
            />
            <StatTile
              icon={Users}
              tint="bg-info/15 text-info"
              value={activeEnrollments.length}
              label="Enrolled"
              sub={prog.capacity ? `of ${prog.capacity} capacity` : "on the roster"}
            />
            <StatTile
              icon={Clock}
              tint="bg-success/15 text-success"
              value={upcomingCount}
              label="Upcoming"
              sub="today or later"
            />
            {prog.price_cents ? (
              <StatTile
                icon={DollarSign}
                tint="bg-warning/15 text-warning"
                value={fmtPrice(prog.price_cents)}
                label="Price"
                sub="per athlete"
              />
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-4">
          {/* Sessions */}
          <Card className="rounded-2xl border-border bg-card">
            <CardContent className="pt-4 pb-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <PanelLabel>Sessions ({sessions.length})</PanelLabel>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg text-xs"
                  onClick={() => setShowAddSession((v) => !v)}
                  data-testid="session-add-toggle"
                >
                  {showAddSession
                    ? <><X className="h-3.5 w-3.5 mr-1" /> Cancel</>
                    : <><Plus className="h-3.5 w-3.5 mr-1" /> Add session</>}
                </Button>
              </div>

              {showAddSession && (
                <AddSessionForm
                  date={sessionDate}
                  focus={sessionFocus}
                  onDateChange={setSessionDate}
                  onFocusChange={setSessionFocus}
                  onAdd={addSession}
                  busy={busy}
                />
              )}

              {sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No sessions yet — tap Add session to set the first date.</p>
              ) : (
                <div className="space-y-2">
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      role={s.event_id ? "button" : undefined}
                      tabIndex={s.event_id ? 0 : undefined}
                      onClick={s.event_id ? () => navigate(`/events/${s.event_id}`) : undefined}
                      onKeyDown={s.event_id ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/events/${s.event_id}`); } } : undefined}
                      className={cn(
                        "rounded-xl border border-border bg-background px-4 py-3 flex flex-wrap items-center justify-between gap-2 transition-all",
                        s.event_id && "cursor-pointer hover:border-brand/50 hover:shadow-lg hover:-translate-y-0.5",
                        activeSessionId === s.id && "border-brand/50"
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
            </CardContent>
          </Card>

          {/* Attendance — driven by the session roster, not by enrollments. */}
          {activeSessionId && (
            <Card className="rounded-2xl border-brand/40 bg-brand-tertiary" data-testid="attendance-panel">
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <PanelLabel>
                      Session attendance{activeSession ? ` · #${activeSession.session_number} · ${activeSession.date}` : ""}
                    </PanelLabel>
                    {roster && (roster.source === "event" && roster.event_id ? (
                      <p className="text-xs text-info mt-1">
                        Following the event roster for this session ·{" "}
                        <Link to={`/events/${roster.event_id}?tab=roster`} className="underline" onClick={(e) => e.stopPropagation()}>
                          Open event roster
                        </Link>
                      </p>
                    ) : (
                      <p className="text-xs text-info mt-1">
                        Following program enrollment — create the session&apos;s event to manage a day-specific roster.
                      </p>
                    ))}
                  </div>
                  <Button variant="ghost" className="h-8 text-xs shrink-0" onClick={() => setActiveSessionId(null)}>Close</Button>
                </div>

                {rosterBusy && !roster ? (
                  <div className="space-y-2">
                    <Skeleton className="h-14 rounded-xl" />
                    <Skeleton className="h-14 rounded-xl" />
                  </div>
                ) : (roster?.athletes || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nobody on this session&apos;s roster yet.</p>
                ) : (
                  <div className="space-y-2">
                    {roster.athletes.map((row) => {
                      const st = attendanceMap[row.athlete_id];
                      const a = row.athlete;
                      return (
                        <div key={row.athlete_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-card border border-border px-3 py-2.5">
                          <div className="flex items-center gap-3 min-w-0">
                            <PlayerAvatar firstName={a?.first_name} lastName={a?.last_name} photoUrl={a?.photo_url} size="sm" />
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground truncate">
                                {fullName(a, row.athlete_id)}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {a?.age_group || "—"} · {a?.primary_position || "—"}
                              </p>
                            </div>
                            {row.checked_in && !st && (
                              <span className="rounded-full bg-success/15 text-success text-[10px] font-semibold px-2 py-0.5 shrink-0">
                                Checked in
                              </span>
                            )}
                          </div>
                          <div className="flex gap-1.5">
                            {MARKS.map((status) => (
                              <button
                                key={status}
                                type="button"
                                onClick={() => markAttendance(row.athlete_id, status)}
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
        </div>

        {/* Right rail */}
        <div className="lg:col-span-1 space-y-4">
          {/* Family enrollment: public link/QR into the registration wizard */}
          <Card className="rounded-2xl border-border bg-card" data-testid="program-enroll-share">
            <CardContent className="pt-4 pb-4 space-y-3">
              <PanelLabel>Family enrollment</PanelLabel>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(enrollLink)}`}
                alt="Enrollment QR"
                className="rounded-xl border border-border bg-white p-1.5 w-[150px] h-[150px]"
                data-testid="program-enroll-qr"
              />
              <p className="text-xs text-muted-foreground">
                Parents scan (or tap the link) to create the athlete&apos;s full 60&apos;6&quot; ID profile and enroll in
                this program — signed waivers included. Print the QR for the check-in table.
              </p>
              <p className="text-xs font-mono break-all text-info">{enrollLink}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs"
                  onClick={() => { navigator.clipboard.writeText(enrollLink); toast.success("Enrollment link copied."); }}
                  data-testid="program-enroll-copy-link">
                  Copy link
                </Button>
                <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs"
                  onClick={() => window.open(`https://api.qrserver.com/v1/create-qr-code/?size=800x800&data=${encodeURIComponent(enrollLink)}`, "_blank")}
                  data-testid="program-enroll-big-qr">
                  Open big QR (print)
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Roster */}
          <Card className="rounded-2xl border-border bg-card">
            <CardContent className="pt-4 pb-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <PanelLabel>Roster ({activeEnrollments.length})</PanelLabel>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg text-xs"
                  onClick={() => setShowEnroll((v) => !v)}
                  data-testid="program-enroll-toggle"
                >
                  {showEnroll
                    ? <><X className="h-3.5 w-3.5 mr-1" /> Cancel</>
                    : <><Plus className="h-3.5 w-3.5 mr-1" /> Add athlete</>}
                </Button>
              </div>

              {showEnroll && (
                <EnrollSearch
                  query={enrollQ}
                  onQueryChange={onEnrollSearch}
                  searchBusy={searchBusy}
                  candidates={candidates}
                  enrollingId={enrollingId}
                  onEnroll={enroll}
                />
              )}

              {activeEnrollments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">Nobody enrolled yet — tap Add athlete to search players.</p>
              ) : (
                <div className="space-y-2">
                  {activeEnrollments.map((e) => (
                    <div key={e.id} className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm">
                      <div className="flex items-center gap-3 min-w-0">
                        <PlayerAvatar
                          firstName={e.athlete?.first_name}
                          lastName={e.athlete?.last_name}
                          photoUrl={e.athlete?.photo_url}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground truncate">
                            {fullName(e.athlete, e.athlete_id)}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {e.athlete?.age_group || "—"} · {e.athlete?.primary_position || "—"}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          className="h-8 rounded-lg px-2.5 text-xs text-muted-foreground hover:text-destructive shrink-0"
                          onClick={() => removeAthlete(e)}
                          data-testid={`program-remove-${e.athlete_id}`}
                        >
                          Remove
                        </Button>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs pl-11">
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
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
