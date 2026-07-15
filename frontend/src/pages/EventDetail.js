import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams, useNavigate, Link } from "react-router-dom";
import { api, errMsg, signedUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  ArrowLeft, CalendarDays, MapPin, Users, Plus, Trash2, Search, UserPlus,
  CheckCircle2, XCircle, FileDown, Layers, Trophy, ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";

const EVENT_STATUSES = ["Draft", "Registration Open", "Registration Closed", "Check-In Open", "Evaluation Active", "Evaluation Complete", "Reports Under Review", "Closed"];

// ---------------- Roster tab ----------------
const RosterTab = ({ eventId, isAdmin }) => {
  const [roster, setRoster] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [directory, setDirectory] = useState([]);
  const [selected, setSelected] = useState({});
  const [dirSearch, setDirSearch] = useState("");

  const load = useCallback(() => {
    api.get(`/events/${eventId}/roster`).then((r) => setRoster(r.data));
  }, [eventId]);
  useEffect(load, [load]);

  useEffect(() => {
    if (!addOpen) return;
    api.get("/athletes", { params: { status: "active", search: dirSearch || undefined } }).then((r) => setDirectory(r.data));
  }, [addOpen, dirSearch]);

  const rosterIds = new Set((roster || []).map((r) => r.athlete_id));

  const addSelected = async () => {
    const ids = Object.keys(selected).filter((k) => selected[k]);
    if (!ids.length) return;
    try {
      const r = await api.post(`/events/${eventId}/roster`, { athlete_ids: ids });
      toast.success(r.data.message);
      setAddOpen(false);
      setSelected({});
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const remove = async (athleteId) => {
    try {
      await api.delete(`/events/${eventId}/roster/${athleteId}`);
      toast.success("Player removed from roster.");
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!roster) return <Skeleton className="h-48 rounded-2xl" />;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{roster.length} players on roster</p>
        {isAdmin && (
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button className="rounded-xl bg-[#0B1E3A] hover:bg-[#102A4F] h-10" data-testid="roster-add-players-button">
                <UserPlus className="h-4 w-4 mr-1" /> Add Players
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl max-w-md max-h-[80vh] flex flex-col">
              <DialogHeader><DialogTitle className="font-display text-2xl text-[#0B1E3A]">Add Players to Event</DialogTitle></DialogHeader>
              <Input value={dirSearch} onChange={(e) => setDirSearch(e.target.value)} placeholder="Search directory…" className="h-10 rounded-xl" data-testid="roster-directory-search" />
              <div className="flex-1 overflow-y-auto space-y-1 min-h-[200px]">
                {directory.filter((d) => !rosterIds.has(d.id)).map((d) => (
                  <label key={d.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-[hsl(var(--secondary))] cursor-pointer">
                    <Checkbox checked={!!selected[d.id]} onCheckedChange={(v) => setSelected((s) => ({ ...s, [d.id]: v }))} data-testid={`roster-select-${d.id}`} />
                    <PlayerAvatar firstName={d.first_name} lastName={d.last_name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{d.first_name} {d.last_name}</p>
                      <p className="text-xs text-slate-500">{d.age_group} · {d.primary_position}</p>
                    </div>
                  </label>
                ))}
                {directory.filter((d) => !rosterIds.has(d.id)).length === 0 && <p className="text-sm text-slate-400 text-center py-6">No more players to add.</p>}
              </div>
              <DialogFooter>
                <Button className="w-full rounded-xl bg-[#0B1E3A] h-11" onClick={addSelected} disabled={!Object.values(selected).some(Boolean)} data-testid="roster-add-confirm-button">
                  Add {Object.values(selected).filter(Boolean).length} Player(s)
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      {roster.length === 0 ? (
        <EmptyState icon={Users} title="Roster is empty" hint="Add players from the directory or import a CSV first." />
      ) : (
        <div className="space-y-2">
          {roster.map((r) => (
            <Card key={r.athlete_id} className="rounded-2xl border-[#E7E1D6]">
              <CardContent className="py-3 flex items-center gap-3">
                <PlayerAvatar firstName={r.first_name} lastName={r.last_name} bib={r.bib_number} size="sm" />
                <div className="flex-1 min-w-0">
                  <Link to={`/players/${r.athlete_id}`} className="text-sm font-semibold text-[#0B1E3A] hover:underline truncate block">{r.first_name} {r.last_name}</Link>
                  <p className="text-xs text-slate-500">{r.age_group || "—"} · {r.primary_position || "—"} · {r.group_name || "No group"}</p>
                </div>
                <StatusBadge status={r.status} />
                {isAdmin && (
                  <Button variant="ghost" size="icon" onClick={() => remove(r.athlete_id)} data-testid={`roster-remove-${r.athlete_id}`}>
                    <Trash2 className="h-4 w-4 text-slate-400" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------- Check-In tab ----------------
const CheckInTab = ({ eventId, isAdmin }) => {
  const [roster, setRoster] = useState(null);
  const [groups, setGroups] = useState([]);
  const [search, setSearch] = useState("");
  const [walkUpOpen, setWalkUpOpen] = useState(false);
  const [walkUp, setWalkUp] = useState({ first_name: "", last_name: "", date_of_birth: "", primary_position: "", bib_number: "", group_id: "" });

  const load = useCallback(() => {
    api.get(`/events/${eventId}/roster`).then((r) => setRoster(r.data));
    api.get(`/events/${eventId}/groups`).then((r) => setGroups(r.data));
  }, [eventId]);
  useEffect(load, [load]);

  const update = async (athleteId, patch) => {
    try {
      await api.patch(`/events/${eventId}/roster/${athleteId}`, patch);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const addWalkUp = async () => {
    try {
      await api.post(`/events/${eventId}/walk-up`, { ...walkUp, group_id: walkUp.group_id || null, date_of_birth: walkUp.date_of_birth || null });
      toast.success("Walk-up player added and checked in.");
      setWalkUpOpen(false);
      setWalkUp({ first_name: "", last_name: "", date_of_birth: "", primary_position: "", bib_number: "", group_id: "" });
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!roster) return <Skeleton className="h-48 rounded-2xl" />;
  const filtered = roster.filter((r) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return `${r.first_name} ${r.last_name}`.toLowerCase().includes(q) || (r.bib_number || "").includes(q) || r.athlete_id.startsWith(q);
  });
  const checkedIn = roster.filter((r) => r.status === "checked_in").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500"><span className="font-bold text-[#1F7A4D] font-mono-num">{checkedIn}</span> of {roster.length} checked in</p>
        {isAdmin && (
          <Dialog open={walkUpOpen} onOpenChange={setWalkUpOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="rounded-xl h-10" data-testid="walk-up-button"><Plus className="h-4 w-4 mr-1" /> Walk-Up Player</Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl max-w-sm">
              <DialogHeader><DialogTitle className="font-display text-2xl text-[#0B1E3A]">Add Walk-Up Player</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">First name *</Label><Input value={walkUp.first_name} onChange={(e) => setWalkUp((w) => ({ ...w, first_name: e.target.value }))} className="h-10 rounded-lg" data-testid="walkup-first-name" /></div>
                <div className="space-y-1"><Label className="text-xs">Last name *</Label><Input value={walkUp.last_name} onChange={(e) => setWalkUp((w) => ({ ...w, last_name: e.target.value }))} className="h-10 rounded-lg" data-testid="walkup-last-name" /></div>
                <div className="space-y-1"><Label className="text-xs">Date of birth</Label><Input type="date" value={walkUp.date_of_birth} onChange={(e) => setWalkUp((w) => ({ ...w, date_of_birth: e.target.value }))} className="h-10 rounded-lg" /></div>
                <div className="space-y-1"><Label className="text-xs">Position</Label><Input value={walkUp.primary_position} onChange={(e) => setWalkUp((w) => ({ ...w, primary_position: e.target.value }))} className="h-10 rounded-lg" /></div>
                <div className="space-y-1"><Label className="text-xs">Bib #</Label><Input value={walkUp.bib_number} onChange={(e) => setWalkUp((w) => ({ ...w, bib_number: e.target.value }))} className="h-10 rounded-lg" data-testid="walkup-bib" /></div>
                <div className="space-y-1">
                  <Label className="text-xs">Group</Label>
                  <Select value={walkUp.group_id || undefined} onValueChange={(v) => setWalkUp((w) => ({ ...w, group_id: v }))}>
                    <SelectTrigger className="h-10 rounded-lg"><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>{groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button className="w-full rounded-xl bg-[#0B1E3A] h-11" disabled={!walkUp.first_name || !walkUp.last_name} onClick={addWalkUp} data-testid="walkup-submit">Add & Check In</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, bib #, or ID…" className="pl-9 h-12 rounded-xl bg-white" data-testid="check-in-search-input" />
      </div>
      <div className="space-y-2">
        {filtered.map((r) => (
          <Card key={r.athlete_id} className={cn("rounded-2xl border-[#E7E1D6]", r.status === "checked_in" && "bg-[#EAF7EF]/40")}>
            <CardContent className="py-3">
              <div className="flex items-center gap-3">
                <PlayerAvatar firstName={r.first_name} lastName={r.last_name} bib={r.bib_number} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#0B1E3A] truncate">{r.first_name} {r.last_name} {r.walk_up && <span className="text-[10px] text-[#B45309] font-normal">(walk-up)</span>}</p>
                  <p className="text-xs text-slate-500">{r.age_group || "—"} · {r.group_name || "No group"}</p>
                </div>
                <StatusBadge status={r.status} />
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className={cn("rounded-lg h-10 flex-1 min-w-[110px] font-semibold", r.status === "checked_in" ? "bg-white text-[#1F7A4D] border border-[#BFE6CC] hover:bg-[#EAF7EF]" : "bg-[#1F7A4D] hover:bg-[#14532D] text-white")}
                  onClick={() => update(r.athlete_id, { status: r.status === "checked_in" ? "registered" : "checked_in" })}
                  data-testid={`check-in-toggle-${r.athlete_id}`}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" /> {r.status === "checked_in" ? "Checked In" : "Check In"}
                </Button>
                <Button size="sm" variant="outline" className="rounded-lg h-10" onClick={() => update(r.athlete_id, { status: "absent" })} data-testid={`mark-absent-${r.athlete_id}`}>
                  <XCircle className="h-4 w-4 mr-1" /> Absent
                </Button>
                <Input
                  defaultValue={r.bib_number || ""}
                  placeholder="Bib #"
                  className="h-10 w-20 rounded-lg font-mono-num text-center"
                  onBlur={(e) => e.target.value !== (r.bib_number || "") && update(r.athlete_id, { bib_number: e.target.value })}
                  data-testid={`check-in-bib-input-${r.athlete_id}`}
                />
                <Select value={r.group_id || undefined} onValueChange={(v) => update(r.athlete_id, { group_id: v })}>
                  <SelectTrigger className="h-10 w-[150px] rounded-lg" data-testid={`check-in-group-select-${r.athlete_id}`}><SelectValue placeholder="Group" /></SelectTrigger>
                  <SelectContent>{groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

// ---------------- Groups tab ----------------
const GroupsTab = ({ eventId, isAdmin }) => {
  const [groups, setGroups] = useState(null);
  const [name, setName] = useState("");
  const load = useCallback(() => api.get(`/events/${eventId}/groups`).then((r) => setGroups(r.data)), [eventId]);
  useEffect(load, [load]);

  const add = async () => {
    if (!name.trim()) return;
    try {
      await api.post(`/events/${eventId}/groups`, { name: name.trim() });
      setName("");
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const remove = async (gid) => {
    try { await api.delete(`/events/${eventId}/groups/${gid}`); load(); } catch (e) { toast.error(errMsg(e)); }
  };

  if (!groups) return <Skeleton className="h-40 rounded-2xl" />;
  return (
    <div className="space-y-3">
      {isAdmin && (
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New group name (e.g. Group A - 12U)" className="h-11 rounded-xl bg-white" data-testid="group-name-input" onKeyDown={(e) => e.key === "Enter" && add()} />
          <Button className="rounded-xl bg-[#0B1E3A] h-11" onClick={add} data-testid="group-add-button"><Plus className="h-4 w-4" /></Button>
        </div>
      )}
      {groups.length === 0 ? <EmptyState icon={Layers} title="No groups yet" hint="Create groups like 'Group A - 10U' to organize players." /> : (
        <div className="grid gap-2 sm:grid-cols-2">
          {groups.map((g) => (
            <Card key={g.id} className="rounded-2xl border-[#E7E1D6]">
              <CardContent className="py-4 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-[#0B1E3A]">{g.name}</p>
                  <p className="text-xs text-slate-500">{g.player_count} players</p>
                </div>
                {isAdmin && <Button variant="ghost" size="icon" onClick={() => remove(g.id)} data-testid={`group-delete-${g.id}`}><Trash2 className="h-4 w-4 text-slate-400" /></Button>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------- Stations tab ----------------
const StationsTab = ({ eventId, isAdmin }) => {
  const [stations, setStations] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [groups, setGroups] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", template_id: "", group_ids: [], start_time: "09:30", end_time: "14:30" });

  const load = useCallback(() => {
    api.get(`/events/${eventId}/stations`).then((r) => setStations(r.data));
    api.get("/templates").then((r) => setTemplates(r.data));
    api.get(`/events/${eventId}/groups`).then((r) => setGroups(r.data));
  }, [eventId]);
  useEffect(load, [load]);

  const add = async () => {
    try {
      await api.post(`/events/${eventId}/stations`, form);
      toast.success("Station created.");
      setOpen(false);
      setForm({ name: "", template_id: "", group_ids: [], start_time: "09:30", end_time: "14:30" });
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const remove = async (sid) => {
    try { await api.delete(`/events/${eventId}/stations/${sid}`); load(); } catch (e) { toast.error(errMsg(e)); }
  };

  if (!stations) return <Skeleton className="h-40 rounded-2xl" />;
  return (
    <div className="space-y-3">
      {isAdmin && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-xl bg-[#0B1E3A] h-10" data-testid="station-add-button"><Plus className="h-4 w-4 mr-1" /> Add Station</Button>
          </DialogTrigger>
          <DialogContent className="rounded-2xl max-w-sm">
            <DialogHeader><DialogTitle className="font-display text-2xl text-[#0B1E3A]">New Station</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1"><Label className="text-xs">Station name *</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="h-10 rounded-lg" placeholder="e.g. Hitting" data-testid="station-name-input" /></div>
              <div className="space-y-1">
                <Label className="text-xs">Evaluation template *</Label>
                <Select value={form.template_id || undefined} onValueChange={(v) => setForm((f) => ({ ...f, template_id: v }))}>
                  <SelectTrigger className="h-10 rounded-lg" data-testid="station-template-select"><SelectValue placeholder="Select template" /></SelectTrigger>
                  <SelectContent>{templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Groups (leave empty for all)</Label>
                <div className="space-y-1.5">
                  {groups.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={form.group_ids.includes(g.id)} onCheckedChange={(v) => setForm((f) => ({ ...f, group_ids: v ? [...f.group_ids, g.id] : f.group_ids.filter((x) => x !== g.id) }))} />
                      {g.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Start</Label><Input type="time" value={form.start_time} onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} className="h-10 rounded-lg" /></div>
                <div className="space-y-1"><Label className="text-xs">End</Label><Input type="time" value={form.end_time} onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))} className="h-10 rounded-lg" /></div>
              </div>
            </div>
            <DialogFooter><Button className="w-full rounded-xl bg-[#0B1E3A] h-11" disabled={!form.name || !form.template_id} onClick={add} data-testid="station-create-submit">Create Station</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {stations.length === 0 ? <EmptyState icon={Layers} title="No stations yet" hint="Create stations like Hitting, Infield, Pitching with an evaluation template." /> : (
        <div className="grid gap-2 md:grid-cols-2">
          {stations.map((s) => (
            <Card key={s.id} className="rounded-2xl border-[#E7E1D6]">
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-[#0B1E3A]">{s.name}</p>
                    <p className="text-xs text-slate-500">{s.template_name || "No template"} · {s.evaluator_count} evaluator(s)</p>
                  </div>
                  {isAdmin && <Button variant="ghost" size="icon" onClick={() => remove(s.id)} data-testid={`station-delete-${s.id}`}><Trash2 className="h-4 w-4 text-slate-400" /></Button>}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex-1 h-2 rounded-full bg-[hsl(var(--muted))] overflow-hidden">
                    <div className="h-full bg-[#1F4AA8] rounded-full" style={{ width: `${s.completion_pct}%` }} />
                  </div>
                  <p className="text-xs font-mono-num text-slate-600">{s.completed}/{s.expected} · {s.completion_pct}%</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------- Evaluators tab ----------------
const EvaluatorsTab = ({ eventId, isAdmin }) => {
  const [assignments, setAssignments] = useState(null);
  const [staff, setStaff] = useState([]);
  const [stations, setStations] = useState([]);
  const [groups, setGroups] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ evaluator_id: "", station_id: "", group_ids: [] });

  const load = useCallback(() => {
    api.get(`/events/${eventId}/assignments`).then((r) => setAssignments(r.data));
    api.get(`/events/${eventId}/stations`).then((r) => setStations(r.data));
    api.get(`/events/${eventId}/groups`).then((r) => setGroups(r.data));
    if (isAdmin) api.get("/staff").then((r) => setStaff(r.data.filter((s) => ["evaluator", "head_scout", "coach", "admin", "owner"].includes(s.role))));
  }, [eventId, isAdmin]);
  useEffect(load, [load]);

  const add = async () => {
    try {
      await api.post(`/events/${eventId}/assignments`, form);
      toast.success("Evaluator assigned.");
      setOpen(false);
      setForm({ evaluator_id: "", station_id: "", group_ids: [] });
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const remove = async (aid) => {
    try { await api.delete(`/events/${eventId}/assignments/${aid}`); load(); } catch (e) { toast.error(errMsg(e)); }
  };

  if (!assignments) return <Skeleton className="h-40 rounded-2xl" />;
  return (
    <div className="space-y-3">
      {isAdmin && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-xl bg-[#0B1E3A] h-10" data-testid="assignment-add-button"><Plus className="h-4 w-4 mr-1" /> Assign Evaluator</Button>
          </DialogTrigger>
          <DialogContent className="rounded-2xl max-w-sm">
            <DialogHeader><DialogTitle className="font-display text-2xl text-[#0B1E3A]">Assign Evaluator</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Evaluator *</Label>
                <Select value={form.evaluator_id || undefined} onValueChange={(v) => setForm((f) => ({ ...f, evaluator_id: v }))}>
                  <SelectTrigger className="h-10 rounded-lg" data-testid="assignment-evaluator-select"><SelectValue placeholder="Select staff member" /></SelectTrigger>
                  <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name} ({s.role})</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Station *</Label>
                <Select value={form.station_id || undefined} onValueChange={(v) => setForm((f) => ({ ...f, station_id: v }))}>
                  <SelectTrigger className="h-10 rounded-lg" data-testid="assignment-station-select"><SelectValue placeholder="Select station" /></SelectTrigger>
                  <SelectContent>{stations.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Player groups (leave empty for all)</Label>
                <div className="space-y-1.5">
                  {groups.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={form.group_ids.includes(g.id)} onCheckedChange={(v) => setForm((f) => ({ ...f, group_ids: v ? [...f.group_ids, g.id] : f.group_ids.filter((x) => x !== g.id) }))} />
                      {g.name}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter><Button className="w-full rounded-xl bg-[#0B1E3A] h-11" disabled={!form.evaluator_id || !form.station_id} onClick={add} data-testid="assignment-create-submit">Assign</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {assignments.length === 0 ? <EmptyState icon={Users} title="No evaluators assigned" hint="Assign evaluators to stations and player groups." /> : (
        <div className="space-y-2">
          {assignments.map((a) => (
            <Card key={a.id} className="rounded-2xl border-[#E7E1D6]">
              <CardContent className="py-3.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#0B1E3A]">{a.evaluator_name}</p>
                  <p className="text-xs text-slate-500">{a.station_name} · {(a.group_names || []).join(", ") || "All groups"}</p>
                </div>
                {isAdmin && <Button variant="ghost" size="icon" onClick={() => remove(a.id)} data-testid={`assignment-delete-${a.id}`}><Trash2 className="h-4 w-4 text-slate-400" /></Button>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------- Live Progress tab ----------------
const ProgressTab = ({ eventId }) => {
  const [data, setData] = useState(null);
  useEffect(() => {
    const load = () => api.get(`/events/${eventId}/progress`).then((r) => setData(r.data)).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [eventId]);

  if (!data) return <Skeleton className="h-48 rounded-2xl" />;
  return (
    <div className="space-y-4" data-testid="live-progress">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Players", value: data.total_players },
          { label: "Checked In", value: data.checked_in },
          { label: "Evals Completed", value: data.evaluations_completed },
          { label: "Evals Remaining", value: data.evaluations_remaining },
        ].map((s) => (
          <Card key={s.label} className="rounded-2xl border-[#E7E1D6]"><CardContent className="py-4 text-center">
            <p className="text-2xl font-bold font-mono-num text-[#0B1E3A]">{s.value}</p>
            <p className="text-xs text-slate-500">{s.label}</p>
          </CardContent></Card>
        ))}
      </div>
      <Card className="rounded-2xl card-shadow border-[#E7E1D6]">
        <CardContent className="pt-4 pb-4 space-y-3">
          <p className="font-semibold text-[#0B1E3A] text-sm">Station completion</p>
          {data.station_progress.map((s) => (
            <div key={s.station_id}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-slate-700">{s.station_name}</span>
                <span className="font-mono-num text-slate-500">{s.completed}/{s.expected} · {s.completion_pct}% {s.drafts > 0 && `(+${s.drafts} drafts)`}</span>
              </div>
              <div className="h-2.5 rounded-full bg-[hsl(var(--muted))] overflow-hidden">
                <div className="h-full bg-[#1F4AA8] rounded-full transition-all" style={{ width: `${s.completion_pct}%` }} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className="rounded-2xl card-shadow border-[#E7E1D6] overflow-hidden">
        <Table>
          <TableHeader><TableRow className="bg-[hsl(var(--secondary))]"><TableHead>Evaluator</TableHead><TableHead>Station</TableHead><TableHead className="text-right">Progress</TableHead></TableRow></TableHeader>
          <TableBody>
            {data.evaluator_progress.map((e, i) => (
              <TableRow key={i}>
                <TableCell className="font-semibold">{e.evaluator_name}</TableCell>
                <TableCell className="text-slate-600">{e.station_name}</TableCell>
                <TableCell className="text-right font-mono-num">{e.completed}/{e.expected} ({e.completion_pct}%)</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};

// ---------------- Results tab ----------------
const ResultsTab = ({ eventId }) => {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api.get("/reports/leaderboard", { params: { event_id: eventId } }).then((r) => setRows(r.data)).catch(() => setRows([]));
  }, [eventId]);

  if (!rows) return <Skeleton className="h-48 rounded-2xl" />;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" className="rounded-xl h-10" onClick={() => window.open(signedUrl(`/reports/event-results/${eventId}/csv`), "_blank")} data-testid="results-export-csv">
          <FileDown className="h-4 w-4 mr-1" /> Export CSV
        </Button>
      </div>
      {rows.length === 0 ? <EmptyState icon={Trophy} title="No results yet" hint="Results appear once evaluations are submitted." /> : (
        <Card className="rounded-2xl card-shadow border-[#E7E1D6] overflow-hidden">
          <Table data-testid="results-table">
            <TableHeader><TableRow className="bg-[hsl(var(--secondary))]"><TableHead>#</TableHead><TableHead>Player</TableHead><TableHead>Age</TableHead><TableHead>Pos</TableHead><TableHead className="text-right">Overall</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.athlete.id}>
                  <TableCell><span className="font-display text-lg text-[#F4B400]">{r.rank}</span></TableCell>
                  <TableCell><Link to={`/players/${r.athlete.id}`} className="font-semibold text-[#0B1E3A] hover:underline">{r.athlete.first_name} {r.athlete.last_name}</Link></TableCell>
                  <TableCell>{r.athlete.age_group}</TableCell>
                  <TableCell>{r.athlete.primary_position}</TableCell>
                  <TableCell className="text-right font-mono-num font-bold">{r.overall_score}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
};

// ---------------- Main event page ----------------
export default function EventDetail() {
  const { eventId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [event, setEvent] = useState(null);
  const isAdmin = ["owner", "admin"].includes(user?.role);
  const isStaffView = ["owner", "admin", "head_scout", "coach"].includes(user?.role);
  const tab = params.get("tab") || "overview";

  const load = useCallback(() => {
    api.get(`/events/${eventId}`).then((r) => setEvent(r.data)).catch((e) => { toast.error(errMsg(e)); navigate("/events"); });
  }, [eventId, navigate]);
  useEffect(load, [load]);

  const setStatus = async (status) => {
    try {
      await api.post(`/events/${eventId}/status`, { status });
      toast.success(`Event status: ${status}`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!event) return <div className="space-y-3"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>;

  const tabs = isStaffView
    ? ["overview", "roster", "checkin", "groups", "stations", "evaluators", "progress", "results"]
    : ["overview"];
  const TAB_LABELS = { overview: "Overview", roster: "Roster", checkin: "Check-In", groups: "Groups", stations: "Stations", evaluators: "Evaluators", progress: "Live Progress", results: "Results" };

  return (
    <div className="space-y-4">
      <div>
        <button onClick={() => navigate("/events")} className="inline-flex items-center gap-1 text-sm text-[#1F4AA8] hover:underline mb-1" data-testid="event-back-button">
          <ArrowLeft className="h-3.5 w-3.5" /> Events
        </button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-4xl text-[#0B1E3A]">{event.name}</h1>
            <p className="text-sm text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
              <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {event.date} {event.start_time && `· ${event.start_time}–${event.end_time}`}</span>
              {event.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {event.location}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={event.status} testId="event-status-badge" />
            {isAdmin && (
              <Select value={event.status} onValueChange={setStatus}>
                <SelectTrigger className="h-10 w-[190px] rounded-xl bg-white" data-testid="event-status-select"><SelectValue /></SelectTrigger>
                <SelectContent>{EVENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <div className="overflow-x-auto -mx-4 px-4">
          <TabsList className="rounded-xl bg-[hsl(var(--secondary))] h-11 w-max">
            {tabs.map((t) => (
              <TabsTrigger key={t} value={t} className="rounded-lg px-3.5 data-[state=active]:bg-[#0B1E3A] data-[state=active]:text-white" data-testid={`event-tab-${t}`}>
                {TAB_LABELS[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "Players", value: event.player_count, icon: Users },
              { label: "Checked In", value: event.checked_in_count, icon: CheckCircle2 },
              { label: "Evaluators", value: event.evaluator_count, icon: ClipboardList },
              { label: "Stations", value: event.station_count, icon: Layers },
              { label: "Groups", value: event.group_count, icon: Layers },
            ].map((s) => (
              <Card key={s.label} className="rounded-2xl border-[#E7E1D6]"><CardContent className="py-4 text-center">
                <p className="text-2xl font-bold font-mono-num text-[#0B1E3A]">{s.value ?? 0}</p>
                <p className="text-xs text-slate-500">{s.label}</p>
              </CardContent></Card>
            ))}
          </div>
          {event.description && <Card className="rounded-2xl border-[#E7E1D6] mt-3"><CardContent className="py-4 text-sm text-slate-600">{event.description}</CardContent></Card>}
          {(event.age_groups || []).length > 0 && (
            <div className="flex gap-2 mt-3">{event.age_groups.map((a) => <span key={a} className="rounded-full bg-white border px-3 py-1 text-xs font-semibold text-[#0B1E3A]">{a}</span>)}</div>
          )}
        </TabsContent>

        {isStaffView && (
          <>
            <TabsContent value="roster" className="mt-4"><RosterTab eventId={eventId} isAdmin={isAdmin} /></TabsContent>
            <TabsContent value="checkin" className="mt-4"><CheckInTab eventId={eventId} isAdmin={isAdmin || user?.role === "head_scout" || user?.role === "coach"} /></TabsContent>
            <TabsContent value="groups" className="mt-4"><GroupsTab eventId={eventId} isAdmin={isAdmin} /></TabsContent>
            <TabsContent value="stations" className="mt-4"><StationsTab eventId={eventId} isAdmin={isAdmin} /></TabsContent>
            <TabsContent value="evaluators" className="mt-4"><EvaluatorsTab eventId={eventId} isAdmin={isAdmin} /></TabsContent>
            <TabsContent value="progress" className="mt-4"><ProgressTab eventId={eventId} /></TabsContent>
            <TabsContent value="results" className="mt-4"><ResultsTab eventId={eventId} /></TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
