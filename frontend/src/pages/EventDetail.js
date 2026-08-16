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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  ArrowLeft, CalendarDays, MapPin, Users, Plus, Trash2, Search, UserPlus,
  CheckCircle2, XCircle, FileDown, Layers, Trophy, ClipboardList,
  Clock, Video, AlertTriangle, Activity, RefreshCw, ExternalLink, ChevronRight,
  FileUp, Wand2, Pencil, GitMerge, ListChecks, Circle, ChevronUp, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";

// Canonical event lifecycle. Older events may still carry legacy statuses
// ("Registration Open" etc.) — those keep displaying as stored and appear as
// the current value in the status control, but only canonical ones can be set.
const EVENT_STATUSES = ["Draft", "Setup", "Ready", "Evaluation Active", "Evaluation Complete", "Review", "Published", "Closed"];

// ---------------- Roster CSV import wizard ----------------
const IMPORT_STATUS_META = {
  matched: { label: "Matched", cls: "bg-success/15 text-success border-success/30" },
  new: { label: "New", cls: "bg-info/15 text-info border-info/30" },
  possible_duplicate: { label: "Possible duplicate", cls: "bg-warning/15 text-warning border-warning/40" },
  needs_grad_confirmation: { label: "Needs grad year", cls: "bg-warning/15 text-warning border-warning/40" },
  error: { label: "Error", cls: "bg-brand/15 text-brand border-brand/30" },
};

const importDefaultAction = (status) =>
  status === "matched" || status === "possible_duplicate" ? "use_match" : status === "error" ? "skip" : "create";

const importRowName = (r) => {
  const d = r.data || {};
  const n = `${d.first_name || d["First Name"] || ""} ${d.last_name || d["Last Name"] || ""}`.trim();
  return n || d.name || r.athlete_name || `Row ${r.row}`;
};

// Big-tap-target action chip (mirrors the check-in filter pills).
const ActionChip = ({ active, onClick, children, testid }) => (
  <button
    type="button"
    onClick={onClick}
    data-testid={testid}
    className={cn(
      "h-9 px-3 rounded-full text-xs font-semibold border",
      active ? "bg-brand text-primary-foreground border-brand" : "bg-card text-muted-foreground border-border"
    )}
  >
    {children}
  </button>
);

const ImportRosterWizard = ({ eventId, onDone, onUnavailable }) => {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState("upload"); // upload | preview | confirm | done
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [rowState, setRowState] = useState({});
  const [autoGroup, setAutoGroup] = useState(true);
  const [result, setResult] = useState(null);

  const reset = () => {
    setStep("upload"); setFile(null); setPreview(null); setRowState({}); setAutoGroup(true); setResult(null);
  };

  const setRow = (row, patch) => setRowState((s) => ({ ...s, [row]: { ...s[row], ...patch } }));

  const runPreview = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post(`/events/${eventId}/roster/import/preview`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      const rows = r.data?.rows || [];
      const rs = {};
      rows.forEach((row) => { rs[row.row] = { action: importDefaultAction(row.status), graduation_year: "" }; });
      setRowState(rs);
      setPreview(r.data);
      setStep("preview");
    } catch (e) {
      if (e?.response?.status === 404) {
        setOpen(false);
        onUnavailable?.();
        toast.error("CSV import isn't available on this server yet.");
      } else toast.error(errMsg(e));
    } finally { setBusy(false); }
  };

  const runConfirm = async () => {
    setBusy(true);
    try {
      const rows = (preview?.rows || []).map((r) => {
        const st = rowState[r.row] || {};
        return {
          row: r.row,
          action: st.action || "skip",
          data: r.data,
          athlete_id: r.athlete_id || null,
          graduation_year: st.graduation_year ? Number(st.graduation_year) : null,
        };
      });
      const r = await api.post(`/events/${eventId}/roster/import/confirm`, { rows, auto_group: autoGroup });
      setResult(r.data);
      setStep("done");
      onDone?.();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const summary = preview?.summary || {};
  const chips = [
    { label: "Matched ✓", value: summary.matched, cls: IMPORT_STATUS_META.matched.cls },
    { label: "New", value: summary.new, cls: IMPORT_STATUS_META.new.cls },
    { label: "Possible duplicates ⚠", value: summary.possible_duplicates, cls: IMPORT_STATUS_META.possible_duplicate.cls },
    { label: "Needs grad confirmation", value: summary.needs_confirmation, cls: IMPORT_STATUS_META.needs_grad_confirmation.cls },
    { label: "Errors ✗", value: summary.errors, cls: IMPORT_STATUS_META.error.cls },
  ];

  const actionCounts = (preview?.rows || []).reduce(
    (acc, r) => {
      const a = rowState[r.row]?.action || "skip";
      acc[a] = (acc[a] || 0) + 1;
      if (r.status === "needs_grad_confirmation" && a === "create" && !rowState[r.row]?.graduation_year) acc.no_grad += 1;
      return acc;
    },
    { use_match: 0, create: 0, skip: 0, no_grad: 0 }
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button className="rounded-xl bg-primary hover:bg-brand-secondary h-10" data-testid="event-import-button">
          <FileUp className="h-4 w-4 mr-1" /> Import Roster (CSV · Excel · Word)
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-2xl max-w-lg max-h-[85vh] flex flex-col" data-testid="event-import-dialog">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-foreground">
            {step === "upload" && "Import Roster — Upload File"}
            {step === "preview" && "Import Roster — Review Rows"}
            {step === "confirm" && "Import Roster — Confirm"}
            {step === "done" && "Import Complete"}
          </DialogTitle>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-3">
            <label className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-card px-4 py-8 cursor-pointer hover:bg-secondary">
              <FileUp className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">{file ? file.name : "Choose a file (CSV · Excel · Word)"}</span>
              <span className="text-[11px] text-muted-foreground">Tap to browse</span>
              <input
                type="file"
                accept=".csv,.xlsx,.docx"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                data-testid="event-import-file-input"
              />
            </label>
            <p className="text-[11px] text-muted-foreground">
              Supported columns: First/Last Name, DOB or Age, Grad Year, Positions, B/T, Team, Organization, Bib&nbsp;#.
              Matching rows link to each player's existing 60'6" ID — no duplicate profiles.
              Google Docs/Sheets: File → Download → Word (.docx) / Excel (.xlsx).
            </p>
            <DialogFooter>
              <Button className="w-full rounded-xl bg-primary h-11" disabled={!file || busy} onClick={runPreview} data-testid="event-import-preview-button">
                {busy ? "Analyzing…" : "Preview Import"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "preview" && preview && (
          <div className="flex-1 min-h-0 flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5" data-testid="event-import-summary">
              {chips.map((c) => (
                <span key={c.label} className={cn("text-[11px] font-semibold rounded-full border px-2 py-0.5", c.cls)}>
                  {c.label}: <span className="font-mono-num">{c.value ?? 0}</span>
                </span>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[200px]">
              {(preview.rows || []).map((r) => {
                const st = rowState[r.row] || {};
                const meta = IMPORT_STATUS_META[r.status] || IMPORT_STATUS_META.error;
                const isError = r.status === "error";
                return (
                  <div key={r.row} className="rounded-xl border border-border p-3 space-y-2" data-testid={`event-import-row-${r.row}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {importRowName(r)} <span className="text-[11px] text-muted-foreground font-normal">row {r.row}</span>
                        </p>
                        {r.status === "matched" && (
                          <p className="text-[11px] text-success">Links to existing 60'6" ID{r.athlete_name ? ` — ${r.athlete_name}` : ""}</p>
                        )}
                        {(r.reasons || []).length > 0 && (
                          <p className="text-[11px] text-muted-foreground">{r.reasons.join(" · ")}</p>
                        )}
                      </div>
                      <span className={cn("text-[11px] font-semibold rounded-full border px-2 py-0.5 shrink-0", meta.cls)}>{meta.label}</span>
                    </div>

                    {isError ? (
                      <p className="text-[11px] text-brand">This row can't be imported and will be skipped.</p>
                    ) : r.status === "possible_duplicate" ? (
                      <div className="space-y-1.5">
                        <RadioGroup value={st.action} onValueChange={(v) => setRow(r.row, { action: v })} className="gap-1.5">
                          <label className="flex items-center gap-2 text-sm cursor-pointer min-h-[36px]">
                            <RadioGroupItem value="use_match" data-testid={`event-import-row-${r.row}-use-match`} />
                            Use existing {r.athlete_name || "athlete"}
                          </label>
                          <label className="flex items-center gap-2 text-sm cursor-pointer min-h-[36px]">
                            <RadioGroupItem value="create" data-testid={`event-import-row-${r.row}-create`} />
                            Create new athlete
                          </label>
                          <label className="flex items-center gap-2 text-sm cursor-pointer min-h-[36px]">
                            <RadioGroupItem value="skip" data-testid={`event-import-row-${r.row}-skip`} />
                            Skip this row
                          </label>
                        </RadioGroup>
                        {st.action === "create" && (
                          <p className="text-[11px] text-warning">Creating a new athlete may duplicate an existing 60'6" ID — use the match if it's the same player.</p>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        {r.status === "matched" ? (
                          <ActionChip active={st.action === "use_match"} onClick={() => setRow(r.row, { action: "use_match" })} testid={`event-import-row-${r.row}-use-match`}>
                            Use existing
                          </ActionChip>
                        ) : (
                          <ActionChip active={st.action === "create"} onClick={() => setRow(r.row, { action: "create" })} testid={`event-import-row-${r.row}-create`}>
                            Create
                          </ActionChip>
                        )}
                        <ActionChip active={st.action === "skip"} onClick={() => setRow(r.row, { action: "skip" })} testid={`event-import-row-${r.row}-skip`}>
                          Skip
                        </ActionChip>
                        {r.status === "needs_grad_confirmation" && st.action !== "skip" && (
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              inputMode="numeric"
                              placeholder="Grad yr"
                              value={st.graduation_year || ""}
                              onChange={(e) => setRow(r.row, { graduation_year: e.target.value })}
                              className="h-9 w-24 rounded-lg font-mono-num"
                              data-testid={`event-import-row-${r.row}-grad-year`}
                            />
                            <span className="text-[11px] text-muted-foreground">blank = imports ungrouped</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" className="rounded-xl h-11" onClick={() => setStep("upload")}>Back</Button>
              <Button className="rounded-xl bg-primary h-11 flex-1" onClick={() => setStep("confirm")} data-testid="event-import-continue-button">
                Continue
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "confirm" && preview && (
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-card p-3 text-sm space-y-1">
              <p><span className="font-mono-num font-bold">{actionCounts.use_match}</span> linked to existing 60'6" IDs</p>
              <p><span className="font-mono-num font-bold">{actionCounts.create}</span> new athletes created</p>
              <p><span className="font-mono-num font-bold">{actionCounts.skip}</span> rows skipped</p>
              {actionCounts.no_grad > 0 && (
                <p className="text-[11px] text-warning">{actionCounts.no_grad} row(s) have no grad year and will import ungrouped.</p>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={autoGroup} onCheckedChange={(v) => setAutoGroup(!!v)} data-testid="event-import-autogroup-checkbox" />
              Auto-group by graduation year (creates "Class of…" groups)
            </label>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" className="rounded-xl h-11" onClick={() => setStep("preview")}>Back</Button>
              <Button className="rounded-xl bg-primary h-11 flex-1" disabled={busy} onClick={runConfirm} data-testid="event-import-confirm-button">
                {busy ? "Importing…" : "Confirm Import"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-3" data-testid="event-import-result">
            <div className="rounded-xl border border-success/30 bg-success/10 p-3 text-sm space-y-1">
              <p className="font-semibold text-success">Roster imported.</p>
              <p className="text-foreground">
                <span className="font-mono-num font-bold">{result.added ?? 0}</span> added to roster ·{" "}
                <span className="font-mono-num">{result.matched ?? 0}</span> matched ·{" "}
                <span className="font-mono-num">{result.created ?? 0}</span> created ·{" "}
                <span className="font-mono-num">{result.skipped ?? 0}</span> skipped
              </p>
              {(result.flagged_no_grad ?? 0) > 0 && (
                <p className="text-[11px] text-warning">{result.flagged_no_grad} player(s) had no grad year — assign a group manually.</p>
              )}
            </div>
            {(result.groups || []).length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Groups</p>
                <div className="flex flex-wrap gap-1.5">
                  {result.groups.map((g) => (
                    <span key={g.id} className="text-[11px] font-semibold rounded-full border border-border bg-card px-2 py-0.5">
                      {g.name} <span className="font-mono-num text-muted-foreground">({g.count})</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button className="w-full rounded-xl bg-primary h-11" onClick={() => { setOpen(false); reset(); }} data-testid="event-import-done-button">
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

// ---------------- Roster tab ----------------
// Age-bracket groups ("Ages 9-10") sort youngest-first; anything else falls
// back to name order after them.
const sortGroups = (gs) => [...(gs || [])].sort((a, b) => {
  const lo = (g) => { const m = /^\s*ages?\s+(\d+)/i.exec(g.name || ""); return m ? parseInt(m[1], 10) : 999; };
  return lo(a) - lo(b) || String(a.name).localeCompare(String(b.name));
});

// "PBG Evaluation 13-18U" / "9-12u Eval" -> [13, 18] / [9, 12]. No range in the
// name -> null (no filtering). Unknown/broken athlete ages are never hidden.
const eventAgeRange = (name) => {
  const m = /(\d{1,2})\s*[uU]?\s*[-\u2013]\s*(\d{1,2})\s*[uU]?/.exec(name || "");
  if (!m) return null;
  const lo = parseInt(m[1], 10), hi = parseInt(m[2], 10);
  return lo <= hi ? [lo, hi] : null;
};

const RosterTab = ({ eventId, isAdmin, eventName }) => {
  const [roster, setRoster] = useState(null);
  const [groups, setGroups] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [directory, setDirectory] = useState([]);
  const [selected, setSelected] = useState({});
  const [dirSearch, setDirSearch] = useState("");
  const [addGroupId, setAddGroupId] = useState("");
  const [importAvailable, setImportAvailable] = useState(true);

  const [newToday, setNewToday] = useState([]);

  const load = useCallback(() => {
    api.get(`/events/${eventId}/roster`).then((r) => setRoster(r.data));
    api.get(`/events/${eventId}/groups`).then((r) => setGroups(sortGroups(r.data))).catch(() => setGroups([]));
    // Surface at the top of this roster: EVERY athlete awaiting approval (any
    // date — pending kids must never hide on the Players page mid-event), plus
    // anyone added to the org today for one-tap add.
    api.get("/athletes").then((r) => {
      const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
      const range = eventAgeRange(eventName);
      const fitsEvent = (a) => {
        if (!range) return true;
        const age = a.age;
        if (age == null || age <= 1) return true; // never hide a kid with a broken DOB
        return age >= range[0] && age <= range[1];
      };
      setNewToday((r.data || []).filter((a) =>
        (a.status === "pending" ||
        (a.status === "active" && a.created_at && new Date(a.created_at) >= midnight)) && fitsEvent(a))
        .sort((x, y) =>
          // Approvals first (that's the action the strip exists for), newest first within each.
          (x.status === "pending" ? 0 : 1) - (y.status === "pending" ? 0 : 1) ||
          String(y.created_at || "").localeCompare(String(x.created_at || ""))));
    }).catch(() => setNewToday([]));
  }, [eventId, eventName]);
  useEffect(() => { load(); }, [load]);

  const approveAthlete = async (athleteId) => {
    try { await api.post(`/athletes/${athleteId}/approve`); toast.success("Player approved."); load(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const quickAdd = async (athleteId) => {
    try {
      await api.post(`/events/${eventId}/roster`, { athlete_ids: [athleteId], group_id: null });
      toast.success("Added to the event.");
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  useEffect(() => {
    if (!addOpen) return;
    api.get("/athletes", { params: { status: "active", search: dirSearch || undefined } }).then((r) => setDirectory(r.data));
  }, [addOpen, dirSearch]);

  const rosterIds = new Set((roster || []).map((r) => r.athlete_id));

  const addSelected = async () => {
    const ids = Object.keys(selected).filter((k) => selected[k]);
    if (!ids.length) return;
    try {
      const r = await api.post(`/events/${eventId}/roster`, {
        athlete_ids: ids,
        group_id: addGroupId || null,
      });
      toast.success(r.data.message);
      setAddOpen(false);
      setSelected({});
      setAddGroupId("");
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const setGroup = async (athleteId, groupId) => {
    try {
      await api.patch(`/events/${eventId}/roster/${athleteId}`, { group_id: groupId || null });
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
      {isAdmin && newToday.length > 0 && (
        <Card className="rounded-2xl border-warning/40 bg-warning/5" data-testid="roster-new-today-card">
          <CardContent className="py-3 space-y-2">
            <p className="text-sm font-semibold text-foreground">
              New sign-ups &amp; approvals ({newToday.length})
              {eventAgeRange(eventName) && (
                <span className="text-xs text-muted-foreground font-normal ml-2">
                  showing ages {eventAgeRange(eventName)[0]}–{eventAgeRange(eventName)[1]} · matched to this event
                </span>
              )}
            </p>
            {newToday.map((a) => {
              const onRoster = rosterIds.has(a.id);
              return (
                <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-card border border-border px-3 py-2">
                  <span className="text-sm font-semibold flex-1 min-w-[120px]">
                    {a.first_name} {a.last_name}
                    <span className="text-xs text-muted-foreground font-normal ml-2">{a.age_group || ""} {a.primary_position ? `· ${a.primary_position}` : ""}</span>
                  </span>
                  {a.status === "pending" && (
                    <Button size="sm" className="h-8 rounded-lg text-xs bg-primary hover:bg-brand-secondary" onClick={() => approveAthlete(a.id)} data-testid={`roster-approve-${a.id}`}>
                      Approve
                    </Button>
                  )}
                  {a.status === "active" && !onRoster && (
                    <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={() => quickAdd(a.id)} data-testid={`roster-quickadd-${a.id}`}>
                      Add to event
                    </Button>
                  )}
                  {a.status === "active" && onRoster && (
                    <span className="text-xs font-semibold text-success">On roster ✓</span>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">{roster.length} players on roster</p>
          {groups.length === 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Groups are optional lanes (e.g. 12U A). Create them under the Groups tab, then assign here or at Check-In.
            </p>
          )}
        </div>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            {importAvailable && (
              <ImportRosterWizard eventId={eventId} onDone={load} onUnavailable={() => setImportAvailable(false)} />
            )}
          <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) { setSelected({}); setAddGroupId(""); } }}>
            <DialogTrigger asChild>
              <Button className="rounded-xl bg-primary hover:bg-brand-secondary h-10" data-testid="roster-add-players-button">
                <UserPlus className="h-4 w-4 mr-1" /> Add Players
              </Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl max-w-md max-h-[80vh] flex flex-col">
              <DialogHeader><DialogTitle className="font-display text-2xl text-foreground">Add Players to Event</DialogTitle></DialogHeader>
              <Input value={dirSearch} onChange={(e) => setDirSearch(e.target.value)} placeholder="Search directory…" className="h-10 rounded-xl" data-testid="roster-directory-search" />
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Assign to group (optional)</Label>
                <Select value={addGroupId || "none"} onValueChange={(v) => setAddGroupId(v === "none" ? "" : v)}>
                  <SelectTrigger className="h-10 rounded-xl" data-testid="roster-add-group-select">
                    <SelectValue placeholder="No group yet" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No group yet</SelectItem>
                    {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {groups.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">No groups on this event yet — add them under Groups, or leave unassigned and set later at Check-In.</p>
                )}
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 min-h-[200px]">
                {directory.filter((d) => !rosterIds.has(d.id)).map((d) => (
                  <label key={d.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-secondary cursor-pointer">
                    <Checkbox checked={!!selected[d.id]} onCheckedChange={(v) => setSelected((s) => ({ ...s, [d.id]: v }))} data-testid={`roster-select-${d.id}`} />
                    <PlayerAvatar firstName={d.first_name} lastName={d.last_name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{d.first_name} {d.last_name}</p>
                      <p className="text-xs text-muted-foreground">{d.age_group} · {d.primary_position}</p>
                    </div>
                  </label>
                ))}
                {directory.filter((d) => !rosterIds.has(d.id)).length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No more players to add.</p>}
              </div>
              <DialogFooter>
                <Button className="w-full rounded-xl bg-primary h-11" onClick={addSelected} disabled={!Object.values(selected).some(Boolean)} data-testid="roster-add-confirm-button">
                  Add {Object.values(selected).filter(Boolean).length} Player(s)
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        )}
      </div>
      {roster.length === 0 ? (
        <EmptyState icon={Users} title="Roster is empty" hint="Add players from the directory or import a CSV first." />
      ) : (
        <div className="space-y-2">
          {[...roster].sort((a, b) => {
            // Today's additions float to the top so day-of registrations are
            // immediately visible; everyone else keeps the existing order.
            const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
            const an = a.created_at && new Date(a.created_at) >= midnight ? 1 : 0;
            const bn = b.created_at && new Date(b.created_at) >= midnight ? 1 : 0;
            return bn - an;
          }).map((r) => (
            <Card key={r.athlete_id} className="rounded-2xl border-border">
              <CardContent className="py-3 flex flex-wrap items-center gap-3">
                <PlayerAvatar firstName={r.first_name} lastName={r.last_name} bib={r.bib_number} size="sm" />
                <div className="flex-1 min-w-[140px]">
                  <Link to={`/players/${r.athlete_id}`} className="text-sm font-semibold text-foreground hover:underline truncate block">{r.first_name} {r.last_name}</Link>
                  <p className="text-xs text-muted-foreground">{r.age_group || "—"} · {r.primary_position || "—"}</p>
                </div>
                <StatusBadge status={r.status} />
                {isAdmin ? (
                  <Select value={r.group_id || "none"} onValueChange={(v) => setGroup(r.athlete_id, v === "none" ? null : v)}>
                    <SelectTrigger className="h-9 w-[140px] rounded-lg text-xs" data-testid={`roster-group-select-${r.athlete_id}`}>
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-xs text-muted-foreground">{r.group_name || "Unassigned"}</span>
                )}
                {isAdmin && (
                  <Button variant="ghost" size="icon" onClick={() => remove(r.athlete_id)} data-testid={`roster-remove-${r.athlete_id}`}>
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
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

// ---------------- Positions being evaluated today (Check-In, additive) ----------------
const ALL_POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"];

// Display-only default until the user makes an explicit change: primary + first secondary.
const defaultPositionsToday = (r) => {
  const secondary = Array.isArray(r.secondary_positions) ? r.secondary_positions[0] : r.secondary_position;
  return [r.primary_position, secondary].filter(Boolean).filter((p, i, a) => a.indexOf(p) === i);
};

const PositionsToday = ({ r, onChange }) => {
  const [open, setOpen] = useState(false);
  const explicit = Array.isArray(r.positions_today) && r.positions_today.length > 0;
  const shown = explicit ? r.positions_today : defaultPositionsToday(r);
  const options = [...new Set([...ALL_POSITIONS, ...shown])];
  const toggle = (pos) => {
    const next = shown.includes(pos) ? shown.filter((p) => p !== pos) : [...shown, pos];
    onChange(next); // only persists on explicit change
  };
  return (
    <div className="mt-2" data-testid={`positions-today-${r.athlete_id}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        data-testid={`positions-today-toggle-${r.athlete_id}`}
      >
        <Pencil className="h-3 w-3" />
        Evaluating today:{" "}
        <span className="font-semibold text-foreground">{shown.length ? shown.join(", ") : "—"}</span>
        {!explicit && shown.length > 0 && <span className="text-[10px] text-muted-foreground">(default)</span>}
      </button>
      {open && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {options.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => toggle(p)}
              className={cn(
                "h-8 px-2.5 rounded-full text-[11px] font-semibold border",
                shown.includes(p) ? "bg-brand text-primary-foreground border-brand" : "bg-card text-muted-foreground border-border"
              )}
              data-testid={`positions-today-${r.athlete_id}-${p}`}
            >
              {p}
            </button>
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
  const [filter, setFilter] = useState("remaining"); // remaining | all | in | absent
  const [walkUpOpen, setWalkUpOpen] = useState(false);
  const [walkUp, setWalkUp] = useState({ first_name: "", last_name: "", date_of_birth: "", primary_position: "", bib_number: "", group_id: "" });

  const load = useCallback(() => {
    api.get(`/events/${eventId}/roster`).then((r) => setRoster(r.data));
    api.get(`/events/${eventId}/groups`).then((r) => setGroups(sortGroups(r.data)));
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  const update = async (athleteId, patch) => {
    // Optimistic local update for snappy check-in lines
    setRoster((prev) => (prev || []).map((r) => (r.athlete_id === athleteId ? { ...r, ...patch } : r)));
    try {
      await api.patch(`/events/${eventId}/roster/${athleteId}`, patch);
    } catch (e) {
      toast.error(errMsg(e));
      load();
    }
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
  const checkedIn = roster.filter((r) => r.status === "checked_in").length;
  const remaining = roster.filter((r) => r.status !== "checked_in" && r.status !== "absent").length;
  const filtered = roster.filter((r) => {
    if (filter === "remaining" && (r.status === "checked_in" || r.status === "absent")) return false;
    if (filter === "in" && r.status !== "checked_in") return false;
    if (filter === "absent" && r.status !== "absent") return false;
    const q = search.toLowerCase();
    if (!q) return true;
    return `${r.first_name} ${r.last_name}`.toLowerCase().includes(q) || (r.bib_number || "").includes(q) || r.athlete_id.startsWith(q);
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          <span className="font-bold text-success font-mono-num">{checkedIn}</span> in ·{" "}
          <span className="font-bold text-warning font-mono-num">{remaining}</span> remaining · {roster.length} total
        </p>
        {isAdmin && (
          <Dialog open={walkUpOpen} onOpenChange={setWalkUpOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="rounded-xl h-10" data-testid="walk-up-button"><Plus className="h-4 w-4 mr-1" /> Walk-Up Player</Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl max-w-sm">
              <DialogHeader><DialogTitle className="font-display text-2xl text-foreground">Add Walk-Up Player</DialogTitle></DialogHeader>
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
                <Button className="w-full rounded-xl bg-primary h-11" disabled={!walkUp.first_name || !walkUp.last_name} onClick={addWalkUp} data-testid="walkup-submit">Add & Check In</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <div className="sticky top-14 md:top-0 z-10 -mx-1 px-1 py-2 bg-background/95 space-y-2 border-b border-divider">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, bib #…" className="pl-9 h-12 rounded-xl bg-card" data-testid="check-in-search-input" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {[
            { id: "remaining", label: `Remaining (${remaining})` },
            { id: "all", label: "All" },
            { id: "in", label: "Checked in" },
            { id: "absent", label: "Absent" },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "h-9 px-3 rounded-full text-xs font-semibold border",
                filter === f.id ? "bg-brand text-primary-foreground border-brand" : "bg-card text-muted-foreground border-border"
              )}
              data-testid={`checkin-filter-${f.id}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            {filter === "remaining" ? "Everyone is checked in or marked absent." : "No matching players."}
          </p>
        ) : filtered.map((r) => (
          <Card key={r.athlete_id} className={cn("rounded-2xl border-border", r.status === "checked_in" && "bg-success/10 border-success/30")}>
            <CardContent className="py-3">
              <div className="flex items-center gap-3">
                <PlayerAvatar firstName={r.first_name} lastName={r.last_name} bib={r.bib_number} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{r.first_name} {r.last_name} {r.walk_up && <span className="text-[10px] text-warning font-normal">(walk-up)</span>}</p>
                  <p className="text-xs text-muted-foreground">#{r.bib_number || "—"} · {r.age_group || "—"} · {r.group_name || "No group"}</p>
                </div>
                <StatusBadge status={r.status} />
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className={cn("rounded-lg h-11 flex-1 min-w-[110px] font-semibold", r.status === "checked_in" ? "bg-card text-success border border-success/40 hover:bg-success/15" : "bg-success hover:bg-[hsl(var(--success))] text-white")}
                  onClick={() => update(r.athlete_id, { status: r.status === "checked_in" ? "registered" : "checked_in" })}
                  data-testid={`check-in-toggle-${r.athlete_id}`}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" /> {r.status === "checked_in" ? "Checked In" : "Check In"}
                </Button>
                <Button size="sm" variant="outline" className="rounded-lg h-11" onClick={() => update(r.athlete_id, { status: "absent" })} data-testid={`mark-absent-${r.athlete_id}`}>
                  <XCircle className="h-4 w-4 mr-1" /> Absent
                </Button>
                <Input
                  key={`${r.athlete_id}-${r.bib_number || ""}`}
                  defaultValue={r.bib_number || ""}
                  placeholder="Bib #"
                  className="h-11 w-20 rounded-lg font-mono-num text-center"
                  onBlur={(e) => e.target.value !== (r.bib_number || "") && update(r.athlete_id, { bib_number: e.target.value })}
                  data-testid={`check-in-bib-input-${r.athlete_id}`}
                />
                <Select value={r.group_id || undefined} onValueChange={(v) => update(r.athlete_id, { group_id: v })}>
                  <SelectTrigger className="h-11 w-[150px] rounded-lg" data-testid={`check-in-group-select-${r.athlete_id}`}><SelectValue placeholder="Group" /></SelectTrigger>
                  <SelectContent>{groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <PositionsToday r={r} onChange={(next) => update(r.athlete_id, { positions_today: next })} />
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
  const [autoAvailable, setAutoAvailable] = useState(true);
  const [autoOpen, setAutoOpen] = useState(false);
  const [regroupAll, setRegroupAll] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const [unassigned, setUnassigned] = useState(null); // set after auto-grouping
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [mergeFrom, setMergeFrom] = useState(null); // group being merged away
  const [mergeInto, setMergeInto] = useState("");
  const load = useCallback(() => api.get(`/events/${eventId}/groups`).then((r) => setGroups(sortGroups(r.data))), [eventId]);
  useEffect(() => { load(); }, [load]);

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

  const runAutoGroup = async () => {
    setAutoBusy(true);
    try {
      const r = await api.post(`/events/${eventId}/groups/auto-by-grad`, { regroup_all: regroupAll });
      setUnassigned(r.data?.unassigned || []);
      toast.success(`Auto-grouped into ${(r.data?.groups || []).length} group(s) by grad year.`);
      setAutoOpen(false);
      setRegroupAll(false);
      load();
    } catch (e) {
      if (e?.response?.status === 404) {
        setAutoAvailable(false);
        setAutoOpen(false);
        toast.error("Auto-grouping isn't available on this server yet.");
      } else toast.error(errMsg(e));
    } finally { setAutoBusy(false); }
  };

  const saveRename = async (gid) => {
    const n = editName.trim();
    if (!n) { setEditingId(null); return; }
    try {
      await api.patch(`/events/${eventId}/groups/${gid}`, { name: n });
      setEditingId(null);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const runMerge = async () => {
    if (!mergeFrom || !mergeInto) return;
    try {
      await api.post(`/events/${eventId}/groups/${mergeFrom.id}/merge`, { into_group_id: mergeInto });
      toast.success("Groups merged.");
      setMergeFrom(null);
      setMergeInto("");
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!groups) return <Skeleton className="h-40 rounded-2xl" />;
  return (
    <div className="space-y-3">
      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          <div className="flex gap-2 flex-1 min-w-[220px]">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New group name (e.g. Group A - 12U)" className="h-11 rounded-xl bg-card" data-testid="group-name-input" onKeyDown={(e) => e.key === "Enter" && add()} />
            <Button className="rounded-xl bg-primary h-11" onClick={add} data-testid="group-add-button"><Plus className="h-4 w-4" /></Button>
          </div>
          {autoAvailable && (
            <Dialog open={autoOpen} onOpenChange={setAutoOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="rounded-xl h-11" data-testid="groups-autograd">
                  <Wand2 className="h-4 w-4 mr-1" /> Auto-group by grad year
                </Button>
              </DialogTrigger>
              <DialogContent className="rounded-2xl max-w-sm">
                <DialogHeader><DialogTitle className="font-display text-2xl text-foreground">Auto-Group by Grad Year</DialogTitle></DialogHeader>
                <p className="text-sm text-muted-foreground">
                  Players with a graduation year are placed into "Class of…" groups. Players without one stay ungrouped.
                </p>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={regroupAll} onCheckedChange={(v) => setRegroupAll(!!v)} data-testid="groups-autograd-regroup-all" />
                  Re-group everyone (moves players already in a group)
                </label>
                <DialogFooter>
                  <Button className="w-full rounded-xl bg-primary h-11" disabled={autoBusy} onClick={runAutoGroup} data-testid="groups-autograd-confirm">
                    {autoBusy ? "Grouping…" : "Auto-Group"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      )}
      {unassigned && unassigned.length > 0 && (
        <Card className="rounded-2xl border-warning/40 bg-warning/10" data-testid="groups-unassigned">
          <CardContent className="py-3 space-y-1">
            <p className="text-sm font-semibold text-warning">No grad year — assign manually</p>
            <p className="text-xs text-muted-foreground">
              {unassigned.map((u) => u.name).join(", ")}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Set their group on the <Link to={`/events/${eventId}?tab=roster`} className="text-info hover:underline">Roster</Link> or{" "}
              <Link to={`/events/${eventId}?tab=checkin`} className="text-info hover:underline">Check-In</Link> tab.
            </p>
          </CardContent>
        </Card>
      )}
      {groups.length === 0 ? <EmptyState icon={Layers} title="No groups yet" hint="Create groups like 'Group A - 10U' to organize players, or auto-group by grad year." /> : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {groups.map((g) => (
              <Card key={g.id} className="rounded-2xl border-border">
                <CardContent className="py-4 flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {editingId === g.id ? (
                      <Input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveRename(g.id); if (e.key === "Escape") setEditingId(null); }}
                        onBlur={() => saveRename(g.id)}
                        className="h-9 rounded-lg"
                        data-testid={`group-rename-input-${g.id}`}
                      />
                    ) : (
                      <p className="font-semibold text-foreground truncate">{g.name}</p>
                    )}
                    <p className="text-xs text-muted-foreground">{g.player_count} players</p>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center shrink-0">
                      <Button variant="ghost" size="icon" onClick={() => { setEditingId(g.id); setEditName(g.name); }} data-testid={`group-rename-${g.id}`} aria-label={`Rename ${g.name}`}>
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      {groups.length > 1 && (
                        <Button variant="ghost" size="icon" onClick={() => { setMergeFrom(g); setMergeInto(""); }} data-testid={`group-merge-${g.id}`} aria-label={`Merge ${g.name}`}>
                          <GitMerge className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => remove(g.id)} data-testid={`group-delete-${g.id}`}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            To move a single player between groups, use the <Link to={`/events/${eventId}?tab=checkin`} className="text-info hover:underline">Check-In</Link> tab.
          </p>
        </>
      )}
      <Dialog open={!!mergeFrom} onOpenChange={(o) => { if (!o) { setMergeFrom(null); setMergeInto(""); } }}>
        <DialogContent className="rounded-2xl max-w-sm" data-testid="groups-merge-dialog">
          <DialogHeader><DialogTitle className="font-display text-2xl text-foreground">Merge Group</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Move all players from <span className="font-semibold text-foreground">{mergeFrom?.name}</span> into:
          </p>
          <Select value={mergeInto || undefined} onValueChange={setMergeInto}>
            <SelectTrigger className="h-11 rounded-xl" data-testid="groups-merge-into-select"><SelectValue placeholder="Destination group" /></SelectTrigger>
            <SelectContent>
              {groups.filter((g) => g.id !== mergeFrom?.id).map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.name} ({g.player_count})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button className="w-full rounded-xl bg-primary h-11" disabled={!mergeInto} onClick={runMerge} data-testid="groups-merge-confirm">
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ---------------- Module state + ordering controls (Stations / Athletic Testing) ----------------
const MODULE_STATES = [
  { id: "required", label: "Required" },
  { id: "optional", label: "Optional" },
  { id: "not_offered", label: "Not offered" },
];

const ModuleStateControl = ({ value, onChange, testid, disabled }) => (
  <div className="inline-flex rounded-lg border border-border overflow-hidden" data-testid={testid}>
    {MODULE_STATES.map((s) => {
      const active = (value || "required") === s.id;
      return (
        <button
          key={s.id}
          type="button"
          disabled={disabled}
          onClick={() => !active && onChange(s.id)}
          className={cn(
            "h-8 px-2 text-[10px] font-semibold uppercase tracking-wide disabled:cursor-default",
            active
              ? s.id === "required"
                ? "bg-brand text-primary-foreground"
                : s.id === "optional"
                  ? "bg-secondary text-foreground"
                  : "bg-muted text-muted-foreground"
              : "bg-card text-muted-foreground hover:bg-secondary"
          )}
          data-testid={`${testid}-${s.id}`}
        >
          {s.label}
        </button>
      );
    })}
  </div>
);

const OrderArrows = ({ testid, onUp, onDown, upDisabled, downDisabled }) => (
  <div className="flex items-center gap-0.5" data-testid={testid}>
    <button
      type="button"
      onClick={onUp}
      disabled={upDisabled}
      aria-label="Move up"
      className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-secondary disabled:opacity-40"
      data-testid={`${testid}-up`}
    >
      <ChevronUp className="h-4 w-4" />
    </button>
    <button
      type="button"
      onClick={onDown}
      disabled={downDisabled}
      aria-label="Move down"
      className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-secondary disabled:opacity-40"
      data-testid={`${testid}-down`}
    >
      <ChevronDown className="h-4 w-4" />
    </button>
  </div>
);

// ---------------- Athletic Testing card ----------------
// Library-driven: hides itself entirely when GET /athletic-tests 404s (older server).
const AthleticTestingCard = ({ eventId, canEdit }) => {
  const [rows, setRows] = useState(null);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let live = true;
    Promise.all([
      api.get("/athletic-tests"),
      api.get(`/events/${eventId}`).catch(() => null),
    ])
      .then(([lib, ev]) => {
        if (!live) return;
        const library = Array.isArray(lib.data) ? lib.data : [];
        if (!library.length) { setAvailable(false); return; }
        const tc = ev?.data?.testing_config;
        const saved = Array.isArray(tc?.tests) ? tc.tests : Array.isArray(tc) ? tc : [];
        const byKey = Object.fromEntries(saved.map((t) => [t.key, t]));
        const merged = library.map((t, i) => ({
          ...t,
          state: byKey[t.key]?.state || "required",
          order: byKey[t.key]?.order ?? i,
        }));
        merged.sort((a, b) => a.order - b.order);
        setRows(merged);
      })
      .catch(() => { if (live) setAvailable(false); });
    return () => { live = false; };
  }, [eventId]);

  const persist = async (next) => {
    setRows(next);
    try {
      await api.put(`/events/${eventId}/testing`, {
        tests: next.map((t, i) => ({ key: t.key, state: t.state, order: i })),
      });
    } catch (e) {
      if (e?.response?.status === 404) {
        setAvailable(false);
        toast.error("Athletic testing configuration isn't available on this server yet.");
      } else toast.error(errMsg(e));
    }
  };

  const setState = (key, state) => persist(rows.map((t) => (t.key === key ? { ...t, state } : t)));
  const move = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= rows.length) return;
    const arr = [...rows];
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    persist(arr);
  };

  if (!available || !rows) return null;
  return (
    <Card className="rounded-2xl border-border" data-testid="event-testing-card">
      <CardContent className="py-4 space-y-3">
        <div>
          <p className="font-semibold text-sm text-foreground">Athletic Testing</p>
          <p className="text-[11px] text-muted-foreground">
            Independent measurements — recorded to each athlete's permanent history.
          </p>
        </div>
        <div className="space-y-2">
          {rows.map((t, idx) => (
            <div
              key={t.key}
              className={cn(
                "flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2",
                t.state === "not_offered" && "opacity-60"
              )}
              data-testid={`testing-row-${t.key}`}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{t.label || t.key}</p>
                <p className="text-[11px] text-muted-foreground">
                  {t.unit || ""}
                  {t.state === "not_offered" && (t.unit ? " · " : "") }
                  {t.state === "not_offered" && "Not offered — not counted"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <ModuleStateControl
                  value={t.state}
                  disabled={!canEdit}
                  onChange={(v) => setState(t.key, v)}
                  testid={`testing-state-${t.key}`}
                />
                {canEdit && (
                  <OrderArrows
                    testid={`testing-order-${t.key}`}
                    onUp={() => move(idx, -1)}
                    onDown={() => move(idx, 1)}
                    upDisabled={idx === 0}
                    downDisabled={idx === rows.length - 1}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

// ---------------- Stations tab ----------------
const StationsTab = ({ eventId, isAdmin }) => {
  const [stations, setStations] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [groups, setGroups] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", template_id: "", group_ids: [], start_time: "09:30", end_time: "14:30" });
  const [presets, setPresets] = useState(null); // null = unavailable/unknown
  const [presetOpen, setPresetOpen] = useState(false);
  const [presetSel, setPresetSel] = useState({});
  const [presetBusy, setPresetBusy] = useState(false);
  const [moduleControls, setModuleControls] = useState(true); // flips off on 404 (older server)

  const load = useCallback(() => {
    api.get(`/events/${eventId}/stations`).then((r) => setStations(r.data));
    api.get("/templates").then((r) => setTemplates(r.data));
    api.get(`/events/${eventId}/groups`).then((r) => setGroups(sortGroups(r.data)));
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!isAdmin) return;
    api.get("/station-presets")
      .then((r) => setPresets(Array.isArray(r.data) ? r.data : []))
      .catch(() => setPresets(null)); // 404 / error → hide the presets button
  }, [isAdmin]);

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

  const patchStation = async (sid, patch) => {
    setStations((prev) => (prev || []).map((s) => (s.id === sid ? { ...s, ...patch } : s)));
    try {
      await api.patch(`/events/${eventId}/stations/${sid}`, patch);
    } catch (e) {
      if (e?.response?.status === 404) {
        setModuleControls(false);
        toast.error("Station module configuration isn't available on this server yet.");
      } else toast.error(errMsg(e));
      load();
    }
  };

  const moveStation = async (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= stations.length) return;
    const arr = [...stations];
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    setStations(arr);
    try {
      await Promise.all([
        api.patch(`/events/${eventId}/stations/${arr[idx].id}`, { display_order: idx }),
        api.patch(`/events/${eventId}/stations/${arr[j].id}`, { display_order: j }),
      ]);
    } catch (e) {
      if (e?.response?.status === 404) {
        setModuleControls(false);
        toast.error("Station ordering isn't available on this server yet.");
      } else toast.error(errMsg(e));
      load();
    }
  };

  const addPresets = async () => {
    const keys = Object.keys(presetSel).filter((k) => presetSel[k]);
    if (!keys.length) return;
    setPresetBusy(true);
    try {
      await api.post(`/events/${eventId}/stations/presets`, { keys });
      toast.success(`${keys.length} station(s) added from presets.`);
      setPresetOpen(false);
      setPresetSel({});
      load();
    } catch (e) {
      if (e?.response?.status === 404) {
        setPresets(null);
        setPresetOpen(false);
        toast.error("Station presets aren't available on this server yet.");
      } else toast.error(errMsg(e));
    } finally { setPresetBusy(false); }
  };

  if (!stations) return <Skeleton className="h-40 rounded-2xl" />;
  const existingNames = new Set(stations.map((s) => (s.name || "").trim().toLowerCase()));
  return (
    <div className="space-y-3">
      {isAdmin && (
        <div className="flex flex-wrap gap-2">
        </div>
      )}
      {isAdmin && presets && presets.length > 0 && (
        <Card className="rounded-2xl border-border" data-testid="stations-presets">
          <CardContent className="py-3.5 space-y-2">
            <p className="text-sm font-semibold text-foreground">Add stations — tap to add</p>
            <p className="text-xs text-muted-foreground">
              No naming or setup needed: every station automatically loads the age-correct
              form for each athlete (a 13-18 event serves the 13U-18U versions by itself).
            </p>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => {
                const exists = existingNames.has((p.name || "").trim().toLowerCase());
                return (
                  <button
                    key={p.key}
                    type="button"
                    disabled={exists || presetBusy}
                    onClick={async () => {
                      setPresetBusy(true);
                      try {
                        await api.post(`/events/${eventId}/stations/presets`, { keys: [p.key] });
                        toast.success(`${p.name} station added.`);
                        load();
                      } catch (e) { toast.error(errMsg(e)); }
                      finally { setPresetBusy(false); }
                    }}
                    className={cn(
                      "rounded-xl border px-4 h-11 text-sm font-semibold transition inline-flex items-center gap-1.5",
                      exists
                        ? "bg-secondary text-muted-foreground border-border cursor-default"
                        : "bg-card text-foreground border-border hover:border-brand/60 hover:bg-brand-tertiary/20"
                    )}
                    data-testid={`stations-preset-${p.key}`}
                  >
                    {exists ? "\u2713 " : "+ "}{p.name}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
      {isAdmin && (
        <div className="flex flex-wrap gap-2">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="rounded-xl h-10 text-muted-foreground" data-testid="station-add-button"><Plus className="h-4 w-4 mr-1" /> Custom station</Button>
          </DialogTrigger>
          <DialogContent className="rounded-2xl max-w-sm">
            <DialogHeader><DialogTitle className="font-display text-2xl text-foreground">New Station</DialogTitle></DialogHeader>
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
            <DialogFooter><Button className="w-full rounded-xl bg-primary h-11" disabled={!form.name || !form.template_id} onClick={add} data-testid="station-create-submit">Create Station</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      )}
      {stations.length === 0 ? <EmptyState icon={Layers} title="No stations yet" hint="Create stations like Hitting, Infield, Pitching with an evaluation template." /> : (
        <div className="grid gap-2 md:grid-cols-2">
          {stations.map((s, idx) => {
            const supportsModules = moduleControls && (s.module_state !== undefined || s.display_order !== undefined);
            const notOffered = supportsModules && s.module_state === "not_offered";
            return (
            <Card key={s.id} className={cn("rounded-2xl border-border", notOffered && "opacity-60")}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-foreground">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.template_name || "No template"} · {s.evaluator_count} evaluator(s)</p>
                  </div>
                  {isAdmin && <Button variant="ghost" size="icon" onClick={() => remove(s.id)} data-testid={`station-delete-${s.id}`}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>}
                </div>
                {isAdmin && supportsModules && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <ModuleStateControl
                      value={s.module_state || "required"}
                      onChange={(v) => patchStation(s.id, { module_state: v })}
                      testid={`station-module-state-${s.id}`}
                    />
                    <OrderArrows
                      testid={`station-order-${s.id}`}
                      onUp={() => moveStation(idx, -1)}
                      onDown={() => moveStation(idx, 1)}
                      upDisabled={idx === 0}
                      downDisabled={idx === stations.length - 1}
                    />
                  </div>
                )}
                {notOffered && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">Not offered at this event — not counted toward completion.</p>
                )}
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-[hsl(var(--info))] rounded-full" style={{ width: `${s.completion_pct}%` }} />
                  </div>
                  <p className="text-xs font-mono-num text-muted-foreground">{s.completed}/{s.expected} · {s.completion_pct}%</p>
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}
      <AthleticTestingCard eventId={eventId} canEdit={isAdmin} />
    </div>
  );
};

// ---------------- Evaluators tab ----------------
// Plain-English access-length choices for guest invite codes. Each maps to the
// ttl_hours integer the invites API already expects — the API contract is
// unchanged, only the wording is human.
const INVITE_ACCESS_OPTIONS = [
  { id: "end_of_today", label: "End of today" },
  { id: "24h", label: "24 hours" },
  { id: "3d", label: "3 days" },
  { id: "1w", label: "1 week" },
];

const inviteTtlHours = (accessId) => {
  if (accessId === "end_of_today") {
    const now = new Date();
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return Math.max(1, Math.ceil((end - now) / 3600000));
  }
  return { "24h": 24, "3d": 72, "1w": 168 }[accessId] || 24;
};

const EvaluatorsTab = ({ eventId, isAdmin }) => {
  const [assignments, setAssignments] = useState(null);
  const [staff, setStaff] = useState([]);
  const [stations, setStations] = useState([]);
  const [groups, setGroups] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ evaluator_id: "", station_ids: [], group_ids: [] });
  const [invites, setInvites] = useState([]);
  const [inviteForm, setInviteForm] = useState({ role: "evaluator", email: "", station_id: "", access: "24h" });
  const [inviteBusy, setInviteBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/events/${eventId}/assignments`).then((r) => setAssignments(r.data));
    api.get(`/events/${eventId}/stations`).then((r) => setStations(r.data));
    api.get(`/events/${eventId}/groups`).then((r) => setGroups(sortGroups(r.data)));
    if (isAdmin) {
      api.get("/staff").then((r) => setStaff(r.data.filter((s) => ["evaluator", "head_scout", "coach", "admin", "owner"].includes(s.role))));
      api.get(`/events/${eventId}/invites`).then((r) => setInvites(r.data || [])).catch(() => setInvites([]));
    }
  }, [eventId, isAdmin]);
  useEffect(() => { load(); }, [load]);

  const [editing, setEditing] = useState(null); // {id, station_id} of the assignment being edited

  const add = async () => {
    try {
      // One assignment per selected station. Editing with the original station
      // unchecked = move: the old row is revoked after the new ones exist.
      for (const sid of form.station_ids) {
        await api.post(`/events/${eventId}/assignments`,
          { evaluator_id: form.evaluator_id, station_id: sid, group_ids: form.group_ids });
      }
      if (editing && !form.station_ids.includes(editing.station_id)) {
        await api.delete(`/events/${eventId}/assignments/${editing.id}`);
      }
      toast.success(editing ? "Assignment updated." : (form.station_ids.length > 1 ? `Assigned to ${form.station_ids.length} stations.` : "Evaluator assigned."));
      setOpen(false);
      setEditing(null);
      setForm({ evaluator_id: "", station_ids: [], group_ids: [] });
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const startEdit = (a) => {
    setEditing({ id: a.id, station_id: a.station_id });
    setForm({ evaluator_id: a.evaluator_id, station_ids: [a.station_id], group_ids: a.group_ids || [] });
    setOpen(true);
  };
  const remove = async (aid) => {
    try { await api.delete(`/events/${eventId}/assignments/${aid}`); load(); } catch (e) { toast.error(errMsg(e)); }
  };

  const createInvite = async () => {
    setInviteBusy(true);
    try {
      const r = await api.post(`/events/${eventId}/invites`, {
        role: inviteForm.role,
        email: inviteForm.email || undefined,
        station_id: inviteForm.station_id || undefined,
        ttl_hours: inviteTtlHours(inviteForm.access),
      });
      toast.success(`Code ${r.data.code} created — share /redeem`);
      navigator.clipboard?.writeText(r.data.code).catch(() => {});
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setInviteBusy(false); }
  };

  const revokeInvite = async (id) => {
    try {
      await api.post(`/events/invites/${id}/revoke`);
      toast.success("Invite revoked.");
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!assignments) return <Skeleton className="h-40 rounded-2xl" />;
  return (
    <div className="space-y-3">
      {isAdmin && (
        <Card className="rounded-2xl border-border" data-testid="event-invite-codes">
          <CardContent className="py-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-sm">Staff invite codes</p>
                <p className="text-xs text-muted-foreground">Generate a 6-char code. Staff join at <Link to="/redeem" className="text-info hover:underline">/redeem</Link>.</p>
              </div>
              <Button className="rounded-xl bg-primary h-10" disabled={inviteBusy} onClick={createInvite} data-testid="invite-code-create">
                {inviteBusy ? "Creating…" : "Generate code"}
              </Button>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <Select value={inviteForm.role} onValueChange={(v) => setInviteForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger className="h-10 rounded-lg"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="evaluator">Evaluator</SelectItem>
                  <SelectItem value="coach">Coach</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Email (optional)" value={inviteForm.email} onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))} className="h-10 rounded-lg" />
              <Select value={inviteForm.station_id || "__none__"} onValueChange={(v) => setInviteForm((f) => ({ ...f, station_id: v === "__none__" ? "" : v }))}>
                <SelectTrigger className="h-10 rounded-lg"><SelectValue placeholder="Station (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No station</SelectItem>
                  {stations.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={inviteForm.access} onValueChange={(v) => setInviteForm((f) => ({ ...f, access: v }))}>
                <SelectTrigger className="h-10 rounded-lg" data-testid="invite-access-select" aria-label="Access length">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVITE_ACCESS_OPTIONS.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground">
              The code stops working after the time you pick. Guest access always lasts through the end of the event day. Revoke ends a guest's access immediately.
            </p>
            {invites.length > 0 && (
              <div className="space-y-2">
                {invites.map((inv) => (
                  <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 text-sm border-t border-divider pt-2">
                    <div>
                      <p className="font-mono-num font-bold tracking-wider">{inv.code}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {inv.role} · {inv.revoked ? "revoked" : inv.accepted_at ? "redeemed" : "active"}
                        {inv.email ? ` · ${inv.email}` : ""}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {!inv.revoked && !inv.accepted_at && (
                        <>
                          <Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={() => { navigator.clipboard?.writeText(inv.code); toast.success("Code copied"); }}>Copy</Button>
                          <Button size="sm" variant="ghost" className="h-8 rounded-lg text-muted-foreground" onClick={() => revokeInvite(inv.id)}>Revoke</Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {isAdmin && (
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setEditing(null); setForm({ evaluator_id: "", station_id: "", group_ids: [] }); } }}>
          <DialogTrigger asChild>
            <Button className="rounded-xl bg-primary h-10" data-testid="assignment-add-button"><Plus className="h-4 w-4 mr-1" /> Assign Evaluator</Button>
          </DialogTrigger>
          <DialogContent className="rounded-2xl max-w-sm" data-testid="assign-stepper">
            <DialogHeader><DialogTitle className="font-display text-2xl text-foreground">{editing ? "Edit Assignment" : "Assign Evaluator"}</DialogTitle></DialogHeader>
            <p className="text-[11px] text-muted-foreground -mt-2">Evaluator → Group → Station → Save. Event: this one.</p>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs"><span className="font-mono-num text-muted-foreground">1.</span> Evaluator *</Label>
                <Select value={form.evaluator_id || undefined} onValueChange={(v) => setForm((f) => ({ ...f, evaluator_id: v }))}>
                  <SelectTrigger className="h-11 rounded-lg" data-testid="assignment-evaluator-select"><SelectValue placeholder="Select staff member" /></SelectTrigger>
                  <SelectContent>{staff.map((s) => <SelectItem key={s.id} value={s.id}>{s.full_name} ({s.role})</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs"><span className="font-mono-num text-muted-foreground">2.</span> Player groups (leave empty for all)</Label>
                <div className="space-y-1.5">
                  {groups.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 text-sm min-h-[32px] cursor-pointer">
                      <Checkbox checked={form.group_ids.includes(g.id)} onCheckedChange={(v) => setForm((f) => ({ ...f, group_ids: v ? [...f.group_ids, g.id] : f.group_ids.filter((x) => x !== g.id) }))} />
                      {g.name}
                    </label>
                  ))}
                  {groups.length === 0 && <p className="text-[11px] text-muted-foreground">No groups yet — assignment covers all players.</p>}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs"><span className="font-mono-num text-muted-foreground">3.</span> Stations * (pick one or more)</Label>
                <div className="space-y-1.5" data-testid="assignment-station-select">
                  {stations.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm min-h-[32px] cursor-pointer">
                      <Checkbox checked={form.station_ids.includes(s.id)} onCheckedChange={(v) => setForm((f) => ({ ...f, station_ids: v ? [...f.station_ids, s.id] : f.station_ids.filter((x) => x !== s.id) }))} />
                      {s.name}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter><Button className="w-full rounded-xl bg-primary h-11" disabled={!form.evaluator_id || form.station_ids.length === 0} onClick={add} data-testid="assignment-create-submit">
              {form.station_ids.length > 1 ? `Save ${form.station_ids.length} Assignments` : "Save Assignment"}
            </Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {assignments.length === 0 ? <EmptyState icon={Users} title="No evaluators assigned" hint="Assign evaluators to stations and player groups." /> : (
        <div className="space-y-2">
          {assignments.map((a) => (
            <Card key={a.id} className="rounded-2xl border-border">
              <CardContent className="py-3 flex items-center gap-3">
                <p className="flex-1 min-w-0 text-sm truncate">
                  <span className="font-semibold text-foreground">{a.evaluator_name}</span>
                  <span className="text-muted-foreground"> — {(a.group_names || []).join(", ") || "All groups"} · {a.station_name}</span>
                </p>
                {isAdmin && (
                  <>
                    <Button variant="outline" size="sm" className="h-8 rounded-lg shrink-0" onClick={() => startEdit(a)} data-testid={`assignment-edit-${a.id}`}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 rounded-lg text-muted-foreground shrink-0" onClick={() => remove(a.id)} data-testid={`assignment-delete-${a.id}`}>
                      <Trash2 className="h-4 w-4 mr-1" /> Revoke
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------- Live Progress tab ----------------
const MIN_EVAL_SAMPLE = 3; // below this we don't trust an average

const fmtMMSS = (secs) => {
  if (secs == null) return null;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

// A single scannable stat tile. `value` may be a node (for "Not enough data yet").
const KpiCard = ({ label, value, sub, tone = "text-foreground", icon: Icon, title }) => (
  <Card className="rounded-2xl border-border" title={title}>
    <CardContent className="py-4">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        <p className="text-xs">{label}</p>
      </div>
      <p className={cn("text-2xl font-bold font-mono-num mt-1 leading-tight", tone)}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </CardContent>
  </Card>
);

const STATION_STATUS = {
  complete: { label: "Complete", cls: "bg-success/15 text-success border-success/30" },
  draft: { label: "Draft", cls: "bg-warning/15 text-warning border-warning/40" },
  missing: { label: "Missing", cls: "bg-brand/15 text-brand border-brand/30" },
  not_offered: { label: "Not offered", cls: "bg-muted text-muted-foreground border-border" },
  "n/a": { label: "N/A", cls: "bg-muted text-muted-foreground border-border" },
};

// Per-player incomplete drill-down (spec §13). Fetches only while open.
const PlayerProgressDialog = ({ eventId, player, open, onOpenChange }) => {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!open || !player) return;
    setData(null);
    api.get(`/events/${eventId}/players/${player.athlete_id}/progress`).then((r) => setData(r.data)).catch(() => {});
  }, [open, eventId, player]);

  const name = player ? `${player.first_name} ${player.last_name}` : "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl max-w-lg max-h-[85vh] flex flex-col" data-testid="player-progress-dialog">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-foreground">
            {name}{player?.bib_number ? <span className="text-muted-foreground font-mono-num text-lg"> · #{player.bib_number}</span> : null}
          </DialogTitle>
        </DialogHeader>
        {!data ? <Skeleton className="h-40 rounded-xl" /> : (
          <div className="overflow-y-auto space-y-3 pr-1">
            {data.ready_for_submission !== undefined && (() => {
              // Defensive: required_complete may be a count or missing on older servers.
              const applicable = (data.stations || []).filter((s) => s.applies && s.status !== "not_offered");
              const reqStations = applicable.filter((s) => (s.module_state ?? "required") === "required");
              const reqDone = typeof data.required_complete === "number"
                ? data.required_complete
                : reqStations.filter((s) => s.status === "complete").length;
              return data.ready_for_submission ? (
                <Badge data-testid="module-ready-badge" className="bg-success/15 text-success border border-success/30 font-bold tracking-wide">
                  READY FOR FINAL SUBMISSION
                </Badge>
              ) : (
                <Badge data-testid="module-ready-badge" className="bg-warning/15 text-warning border border-warning/40 font-semibold">
                  IN PROGRESS — {reqDone}/{reqStations.length} required modules
                </Badge>
              );
            })()}
            <div className="flex flex-wrap items-center gap-2">
              {data.complete
                ? <Badge className="bg-success/15 text-success border border-success/30">All evaluations complete</Badge>
                : <Badge className="bg-brand/15 text-brand border border-brand/30">{data.stations_missing} station(s) missing</Badge>}
              {data.stations_draft > 0 && <Badge className="bg-warning/15 text-warning border border-warning/40">{data.stations_draft} draft</Badge>}
              {data.late_arrival && <Badge className="bg-info/15 text-info border border-info/30">Late arrival</Badge>}
              {data.walk_up && <Badge className="bg-info/15 text-info border border-info/30">Walk-up</Badge>}
              {data.flagged_incomplete && <Badge className="bg-brand/15 text-brand border border-brand/30">Flagged</Badge>}
            </div>
            <p className="text-xs text-muted-foreground font-mono-num">
              {data.stations_complete}/{data.stations_applicable} stations complete
              {data.group_name ? ` · ${data.group_name}` : ""}
            </p>
            <div className="space-y-2">
              {data.stations.filter((s) => s.applies).map((s) => {
                const meta = STATION_STATUS[s.status] || STATION_STATUS["n/a"];
                const notOffered = s.status === "not_offered";
                const missingCount = (s.missing_required || []).length;
                return (
                  <div key={s.station_id} className={cn("rounded-xl border border-border p-3", notOffered && "opacity-60")}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex items-start gap-2">
                        {s.status === "complete" ? (
                          <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
                        ) : s.status === "missing" ? (
                          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{s.station_name}</p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {notOffered ? "Not offered at this event" : (s.evaluator_name || "Unassigned")}
                          </p>
                          {s.status === "missing" && missingCount > 0 && (
                            <p className="text-[11px] font-semibold text-warning">⚠ {missingCount} required missing</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={cn("text-[11px] font-semibold rounded-full border px-2 py-0.5", meta.cls)}>{meta.label}</span>
                        {s.evaluation_id && (s.status === "complete" || s.status === "draft") && (
                          <Link to={`/evaluation/${s.evaluation_id}/results`} className="text-info hover:underline inline-flex items-center gap-0.5 text-xs" data-testid={`player-eval-link-${s.station_id}`}>
                            Results <ExternalLink className="h-3 w-3" />
                          </Link>
                        )}
                      </div>
                    </div>
                    {s.status === "missing" && (s.missing_required || []).length > 0 && (
                      <div className="mt-2">
                        <p className="text-[11px] text-muted-foreground mb-1">Missing required:</p>
                        <div className="flex flex-wrap gap-1">
                          {s.missing_required.map((m) => (
                            <span key={m.metric_id} className="text-[11px] rounded-md bg-brand/10 text-brand border border-brand/20 px-1.5 py-0.5">
                              {m.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

// ---------------- Athlete-level live progress (additive) ----------------
// Per-station chip marks: ✓ complete, ● in progress, ○ missing; optional
// stations render faded and never count against completion.
const ATHLETE_STATION_CHIP = {
  complete: { mark: "✓", cls: "bg-success/15 text-success border-success/30" },
  in_progress: { mark: "●", cls: "bg-warning/15 text-warning border-warning/40" },
  missing: { mark: "○", cls: "bg-card text-muted-foreground border-border" },
  optional: { mark: "○", cls: "bg-card text-muted-foreground border-border opacity-50" },
};

// Hides itself entirely when GET /events/{id}/progress/athletes is unavailable
// (older server). Polls every 20s while the tab is mounted.
const AthleteProgressSection = ({ eventId }) => {
  const [data, setData] = useState(); // undefined = loading, null = unavailable
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    let live = true;
    const load = () =>
      api.get(`/events/${eventId}/progress/athletes`)
        .then((r) => { if (live) setData(r.data); })
        .catch(() => { if (live) setData((d) => (d === undefined ? null : d)); });
    load();
    const t = setInterval(load, 20000);
    return () => { live = false; clearInterval(t); };
  }, [eventId]);

  if (data === null) return null;
  if (data === undefined) return <Skeleton className="h-40 rounded-2xl" />;

  const totals = data.totals || {};
  const totalChips = [
    { label: "Checked In", value: totals.checked_in, tone: "text-info" },
    { label: "Not Started", value: totals.not_started, tone: "text-muted-foreground" },
    { label: "In Progress", value: totals.in_progress, tone: "text-warning" },
    { label: "Complete", value: totals.complete, tone: "text-success" },
    { label: "Missing", value: totals.missing, tone: "text-brand" },
    { label: "Flagged", value: totals.flagged, tone: totals.flagged ? "text-brand" : "text-muted-foreground" },
    { label: "Submitted", value: totals.submitted, tone: "text-foreground" },
    { label: "Awaiting Review", value: totals.awaiting_review, tone: "text-foreground" },
  ];

  return (
    <Card className="rounded-2xl border-border" data-testid="event-athlete-progress">
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-foreground text-sm">Athletes</p>
          <p className="text-[11px] text-muted-foreground">✓ complete · ● in progress · ○ missing</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {totalChips.map((c) => (
            <span key={c.label} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
              {c.label} <span className={cn("font-mono-num font-bold", c.tone)}>{c.value ?? 0}</span>
            </span>
          ))}
        </div>
        <div className="space-y-1.5">
          {(data.athletes || []).map((a) => {
            const hasMissing = (a.missing || []).length > 0;
            const open = !!expanded[a.athlete_id];
            return (
              <div key={a.athlete_id} className="rounded-xl border border-border" data-testid={`athlete-progress-row-${a.athlete_id}`}>
                <button
                  type="button"
                  onClick={() => hasMissing && setExpanded((s) => ({ ...s, [a.athlete_id]: !s[a.athlete_id] }))}
                  className={cn("w-full px-3 py-2 text-left", hasMissing ? "cursor-pointer hover:bg-secondary rounded-xl" : "cursor-default")}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="font-mono-num text-xs text-muted-foreground w-10 shrink-0">#{a.bib_number || "—"}</span>
                    <span className="text-sm font-semibold text-foreground truncate min-w-[110px] flex-1">
                      {a.name}
                      {a.flagged && <AlertTriangle className="inline h-3.5 w-3.5 text-brand ml-1 mb-0.5" />}
                    </span>
                    <span className="flex items-center gap-2 w-32 shrink-0">
                      <span className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <span
                          className={cn("block h-full rounded-full", a.pct_complete === 100 ? "bg-success" : "bg-brand")}
                          style={{ width: `${a.pct_complete}%` }}
                        />
                      </span>
                      <span className="font-mono-num text-xs text-muted-foreground">{a.pct_complete}%</span>
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {(a.stations || []).map((s) => {
                        const chip = ATHLETE_STATION_CHIP[s.state] || ATHLETE_STATION_CHIP.missing;
                        return (
                          <span key={s.station_id} className={cn("text-[11px] font-semibold rounded-full border px-1.5 py-0.5", chip.cls)}>
                            {s.name} {chip.mark}
                          </span>
                        );
                      })}
                    </span>
                    {hasMissing && (
                      <ChevronRight className={cn("h-4 w-4 text-muted-foreground shrink-0 ml-auto transition-transform", open && "rotate-90")} />
                    )}
                  </div>
                </button>
                {open && hasMissing && (
                  <div className="px-3 pb-2.5 space-y-1 border-t border-divider pt-2">
                    {a.missing.map((m, i) => (
                      <p key={`${m.station}-${i}`} className="text-[11px] text-muted-foreground">
                        <span className="font-semibold text-warning">{m.station}</span>
                        {(m.metrics || []).length > 0
                          ? <> — missing: {m.metrics.join(", ")}</>
                          : " — not started"}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {(data.athletes || []).length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No athletes on the roster yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

const ProgressTab = ({ eventId }) => {
  const [data, setData] = useState(null);
  const [roster, setRoster] = useState(null);
  const [playerSearch, setPlayerSearch] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  useEffect(() => {
    const load = () => api.get(`/events/${eventId}/progress`).then((r) => setData(r.data)).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [eventId]);
  useEffect(() => {
    api.get(`/events/${eventId}/roster`).then((r) => setRoster(r.data)).catch(() => setRoster([]));
  }, [eventId]);

  if (!data) return <Skeleton className="h-48 rounded-2xl" />;

  // Player pipeline (spec §4F) — uses player-level counts, not evaluation counts.
  const chartRows = [
    { name: "Registered", value: data.total_players || 0, fill: "hsl(var(--muted-foreground))" },
    { name: "Checked in", value: data.checked_in || 0, fill: "hsl(var(--info))" },
    { name: "In progress", value: data.players_in_progress || 0, fill: "hsl(var(--warning))" },
    { name: "Complete", value: data.players_complete || 0, fill: "hsl(var(--success))" },
    { name: "Missing", value: data.players_missing_scores || 0, fill: "hsl(var(--brand))" },
  ];

  // Honest averages — never dress up a null or a thin sample as a real number.
  const avgReliable = data.avg_evaluation_seconds != null && (data.avg_evaluation_sample || 0) >= MIN_EVAL_SAMPLE;
  const avgValue = avgReliable
    ? fmtMMSS(data.avg_evaluation_seconds)
    : <span className="text-sm font-normal text-muted-foreground">Not enough data yet</span>;
  const medianLabel = fmtMMSS(data.median_evaluation_seconds);
  const avgSub = avgReliable
    ? `median ${medianLabel || "—"} · n=${data.avg_evaluation_sample}`
    : `${data.avg_evaluation_sample || 0} timed so far`;

  // Sync health — null = not meaningful yet; 0 = clean; >0 = stale devices.
  const syncCaveat = "After an event ends, every leftover draft counts as stale.";
  const syncThresh = data.sync_stale_threshold_minutes;
  let syncValue, syncSub, syncTone;
  if (data.sync_problems == null) {
    syncValue = <span className="text-sm font-normal text-muted-foreground">Not enough data yet</span>;
    syncSub = "Waiting on device sync data.";
    syncTone = "text-foreground";
  } else if (data.sync_problems === 0) {
    syncValue = "All synced";
    syncSub = syncCaveat;
    syncTone = "text-success";
  } else {
    syncValue = String(data.sync_problems);
    syncSub = `device(s) not synced in ${syncThresh ?? 30}+ min. ${syncCaveat}`;
    syncTone = "text-brand";
  }

  const filteredRoster = (roster || []).filter((r) => {
    const q = playerSearch.trim().toLowerCase();
    if (!q) return true;
    return `${r.first_name} ${r.last_name}`.toLowerCase().includes(q) || (r.bib_number || "").toString().includes(q);
  });

  return (
    <div className="space-y-4" data-testid="live-progress">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <KpiCard label="Checked in" icon={CheckCircle2} tone="text-info"
          value={`${data.checked_in ?? 0}/${data.total_players ?? 0}`}
          sub={`${data.players_not_started ?? 0} not started`} />
        <KpiCard label="In progress" icon={Activity} tone="text-warning"
          value={data.players_in_progress ?? 0} />
        <KpiCard label="Players complete" icon={CheckCircle2} tone="text-success"
          value={data.players_complete ?? 0}
          sub={`${pct(data.players_complete ?? 0, data.total_players ?? 0)}% of roster`} />
        <KpiCard label="Missing scores" icon={XCircle} tone="text-brand"
          value={data.players_missing_scores ?? 0} />
        <KpiCard label="Flagged" icon={AlertTriangle} tone={data.players_flagged ? "text-brand" : "text-foreground"}
          value={data.players_flagged ?? 0} />
        <KpiCard label="Active evaluators" icon={Users} tone="text-foreground"
          value={data.active_evaluators ?? 0}
          sub={`${data.evaluations_completed ?? 0}/${data.evaluations_expected ?? 0} evals done`} />
        <KpiCard label="Videos to approve" icon={Video} tone={data.videos_awaiting_approval ? "text-warning" : "text-foreground"}
          value={data.videos_awaiting_approval ?? 0}
          sub={data.media_awaiting_approval ? `${data.media_awaiting_approval} media total` : undefined} />
        <KpiCard label="Avg eval time" icon={Clock} value={avgValue} sub={avgSub}
          title="Average time evaluators spend per evaluation" />
      </div>

      <KpiCard label="Device sync" icon={RefreshCw} value={syncValue} sub={syncSub} tone={syncTone} title={syncCaveat} />

      <Card className="rounded-2xl border-border">
        <CardContent className="pt-4 pb-2">
          <p className="font-semibold text-foreground text-sm mb-2">Event completion</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
              <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                {chartRows.map((e) => <Cell key={e.name} fill={e.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <AthleteProgressSection eventId={eventId} />

      {roster && roster.length > 0 && (
        <Card className="rounded-2xl border-border">
          <CardContent className="pt-4 pb-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-foreground text-sm">Players</p>
              <p className="text-[11px] text-muted-foreground">Tap a player to see what's incomplete</p>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={playerSearch} onChange={(e) => setPlayerSearch(e.target.value)} placeholder="Search name, bib #…" className="pl-9 h-10 rounded-xl bg-card" data-testid="progress-player-search" />
            </div>
            <div className="max-h-80 overflow-y-auto space-y-1.5">
              {filteredRoster.map((r) => (
                <button
                  key={r.athlete_id}
                  type="button"
                  onClick={() => setSelectedPlayer(r)}
                  className="w-full flex items-center gap-3 rounded-xl border border-border px-2.5 py-2 text-left hover:bg-secondary"
                  data-testid={`progress-player-${r.athlete_id}`}
                >
                  <PlayerAvatar firstName={r.first_name} lastName={r.last_name} bib={r.bib_number} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{r.first_name} {r.last_name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">#{r.bib_number || "—"} · {r.group_name || "No group"}</p>
                  </div>
                  <StatusBadge status={r.status} />
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              ))}
              {filteredRoster.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No matching players.</p>}
            </div>
          </CardContent>
        </Card>
      )}

      <PlayerProgressDialog eventId={eventId} player={selectedPlayer} open={!!selectedPlayer} onOpenChange={(o) => { if (!o) setSelectedPlayer(null); }} />

      <Card className="rounded-2xl border-border">
        <CardContent className="pt-4 pb-4 space-y-3">
          <p className="font-semibold text-foreground text-sm">Station completion</p>
          {data.station_progress.map((s) => (
            <div key={s.station_id}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-foreground">{s.station_name}</span>
                <span className="font-mono-num text-muted-foreground">{s.completed}/{s.expected} · {s.completion_pct}% {s.drafts > 0 && `(+${s.drafts} drafts)`}</span>
              </div>
              <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-brand rounded-full transition-all" style={{ width: `${s.completion_pct}%` }} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className="rounded-2xl border-border overflow-hidden">
        <Table>
          <TableHeader><TableRow className="bg-secondary"><TableHead>Evaluator</TableHead><TableHead>Station</TableHead><TableHead className="text-right">Progress</TableHead></TableRow></TableHeader>
          <TableBody>
            {data.evaluator_progress.map((e, i) => (
              <TableRow key={i}>
                <TableCell className="font-semibold">{e.evaluator_name}</TableCell>
                <TableCell className="text-muted-foreground">{e.station_name}</TableCell>
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
        <Card className="rounded-2xl border-border overflow-hidden">
          <Table data-testid="results-table">
            <TableHeader><TableRow className="bg-secondary"><TableHead>#</TableHead><TableHead>Player</TableHead><TableHead>Age</TableHead><TableHead>Pos</TableHead><TableHead className="text-right">Overall</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.athlete.id}>
                  <TableCell><span className="font-display text-lg text-warning">{r.rank}</span></TableCell>
                  <TableCell><Link to={`/players/${r.athlete.id}`} className="font-semibold text-foreground hover:underline">{r.athlete.first_name} {r.athlete.last_name}</Link></TableCell>
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

// ---------------- Setup progress strip (Overview) ----------------
const SetupProgressStrip = ({ event, onGo }) => {
  const activeIdx = EVENT_STATUSES.indexOf("Evaluation Active");
  const curIdx = EVENT_STATUSES.indexOf(event.status);
  const steps = [
    { id: "roster", label: "Roster", done: (event.player_count ?? 0) > 0, tab: "roster" },
    { id: "groups", label: "Groups", done: (event.group_count ?? 0) > 0, tab: "groups" },
    { id: "stations", label: "Stations", done: (event.station_count ?? 0) > 0, tab: "stations" },
    { id: "evaluators", label: "Evaluators", done: (event.evaluator_count ?? 0) > 0, tab: "evaluators" },
    { id: "activated", label: "Activated", done: curIdx >= activeIdx && curIdx !== -1, tab: "overview" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-y-1 rounded-xl border border-border bg-card px-3 py-2" data-testid="event-setup-progress">
      {steps.map((s, i) => (
        <span key={s.id} className="inline-flex items-center">
          {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground mx-0.5" />}
          <button
            type="button"
            onClick={() => onGo(s.tab)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold hover:bg-secondary",
              s.done ? "text-success" : "text-muted-foreground"
            )}
            data-testid={`event-setup-step-${s.id}`}
          >
            {s.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
            {s.label}
          </button>
        </span>
      ))}
    </div>
  );
};

// ---------------- Staffing panel (Overview) ----------------
// Hides itself entirely when GET /events/{id}/staffing is unavailable (older server).
const StaffingPanel = ({ eventId }) => {
  const [data, setData] = useState(); // undefined = loading, null = unavailable
  const [rolesOpen, setRolesOpen] = useState(false);
  const load = useCallback(() => {
    api.get(`/events/${eventId}/staffing`).then((r) => setData(r.data)).catch(() => setData(null));
  }, [eventId]);
  useEffect(() => { load(); }, [load]); // remounts on tab return, so it refreshes after station/assignment edits

  if (data === null) return null;
  if (data === undefined) return <Skeleton className="h-28 rounded-2xl" />;

  const staff = data.staff || {};
  const assigned = data.assigned_evaluators ?? 0;
  const hasData = (data.enrollment ?? 0) > 0 && (data.active_stations ?? 0) > 0;
  const tier = !hasData
    ? null
    : staff.ideal != null && assigned >= staff.ideal
      ? "ideal"
      : staff.recommended != null && assigned >= staff.recommended
        ? "recommended"
        : staff.minimum != null && assigned >= staff.minimum
          ? "minimum"
          : "below";
  const assignedTone = tier === "below" ? "text-brand" : tier === "minimum" ? "text-warning" : "text-success";
  const tierNote =
    tier === "below" ? " — below minimum"
    : tier === "minimum" ? " — meets minimum, below recommended"
    : tier === "recommended" ? " — meets recommendation"
    : tier === "ideal" ? " — at ideal staffing" : "";

  return (
    <Card className="rounded-2xl border-border" data-testid="staffing-panel">
      <CardContent className="py-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-sm text-foreground">Staffing</p>
          <div className="flex items-center gap-1">
            <p className="text-xs text-muted-foreground">
              <span className="font-mono-num font-semibold text-foreground">{data.enrollment ?? 0}</span> athletes —{" "}
              <span className="font-mono-num font-semibold text-foreground">{data.active_stations ?? 0}</span> active stations —{" "}
              <span className="font-mono-num font-semibold text-foreground">{data.groups ?? 0}</span> groups
            </p>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={load} aria-label="Refresh staffing" data-testid="staffing-refresh">
              <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </div>
        </div>

        {!hasData ? (
          <p className="text-sm text-muted-foreground">Not enough data yet — add players and stations to see staffing guidance.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "minimum", label: "Minimum", value: staff.minimum },
                { id: "recommended", label: "Recommended", value: staff.recommended },
                { id: "ideal", label: "Ideal", value: staff.ideal },
              ].map((c) => (
                <div
                  key={c.id}
                  className={cn("rounded-xl border p-3 text-center", tier === c.id ? "border-brand ring-1 ring-brand" : "border-border")}
                  data-testid={`staffing-${c.id}`}
                >
                  <p className="text-2xl font-bold font-mono-num text-foreground">{c.value ?? "—"}</p>
                  <p className="text-[11px] text-muted-foreground">{c.label}</p>
                </div>
              ))}
            </div>
            <p className={cn("text-xs font-semibold", assignedTone)} data-testid="staffing-assigned">
              {assigned} evaluator(s) assigned{tierNote}
            </p>
            {data.recommended_groups != null && data.recommended_groups !== (data.groups ?? 0) && (
              <p className="text-[11px] text-muted-foreground">Recommended: {data.recommended_groups} group(s) for this enrollment.</p>
            )}
            {(data.roles || []).length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setRolesOpen((o) => !o)}
                  className="inline-flex items-center gap-1 text-xs text-info hover:underline"
                  data-testid="staffing-roles-toggle"
                >
                  <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", rolesOpen && "rotate-90")} /> Role breakdown
                </button>
                {rolesOpen && (
                  <div className="mt-2 rounded-xl border border-border overflow-hidden">
                    <Table data-testid="staffing-roles-table">
                      <TableHeader>
                        <TableRow className="bg-secondary">
                          <TableHead>Role</TableHead>
                          <TableHead className="text-right">Min</TableHead>
                          <TableHead className="text-right">Rec</TableHead>
                          <TableHead className="text-right">Ideal</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.roles.map((r) => (
                          <TableRow key={r.role}>
                            <TableCell className="font-semibold capitalize">{r.role}</TableCell>
                            <TableCell className="text-right font-mono-num">{r.minimum ?? "—"}</TableCell>
                            <TableCell className="text-right font-mono-num">{r.recommended ?? "—"}</TableCell>
                            <TableCell className="text-right font-mono-num">{r.ideal ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {(data.warnings || []).length > 0 && (
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 space-y-1" data-testid="staffing-warnings">
            {data.warnings.map((w, i) => (
              <p key={i} className="text-xs font-semibold text-warning">⚠ {w}</p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
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

  const load = useCallback(() => {
    api.get(`/events/${eventId}`).then((r) => setEvent(r.data)).catch((e) => { toast.error(errMsg(e)); navigate("/events"); });
  }, [eventId, navigate]);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (status) => {
    try {
      await api.post(`/events/${eventId}/status`, { status });
      toast.success(`Event status: ${status}`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!event) return <div className="space-y-3"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>;

  const defaultTab = event.status === "Check-In Open"
    ? "checkin"
    : event.status === "Evaluation Active"
      ? "progress"
      : "overview";
  const tab = params.get("tab") || defaultTab;

  const tabs = isStaffView
    ? ["overview", "roster", "checkin", "groups", "stations", "evaluators", "progress", "results"]
    : ["overview"];
  const TAB_LABELS = { overview: "Overview", roster: "Roster", checkin: "Check-In", groups: "Groups", stations: "Stations", evaluators: "Evaluators", progress: "Live Progress", results: "Results" };

  return (
    <div className="space-y-4">
      <div>
        <button onClick={() => navigate("/events")} className="inline-flex items-center gap-1 text-sm text-info hover:underline mb-1" data-testid="event-back-button">
          <ArrowLeft className="h-3.5 w-3.5" /> Events
        </button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-4xl text-foreground">{event.name}</h1>
            <p className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
              <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {event.date} {event.start_time && `· ${event.start_time}–${event.end_time}`}</span>
              {event.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {event.location}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={event.status} testId="event-status-badge" />
            {isAdmin && (
              <Select value={event.status} onValueChange={setStatus}>
                <SelectTrigger className="h-10 w-[190px] rounded-xl bg-card" data-testid="event-status-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {!EVENT_STATUSES.includes(event.status) && (
                    <SelectItem value={event.status}>{event.status} (legacy)</SelectItem>
                  )}
                  {EVENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <div className="overflow-x-auto -mx-4 px-4">
          <TabsList className="rounded-xl bg-secondary h-11 w-max">
            {tabs.map((t) => (
              <TabsTrigger key={t} value={t} className="rounded-lg px-3.5 data-[state=active]:bg-primary data-[state=active]:text-white" data-testid={`event-tab-${t}`}>
                {TAB_LABELS[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-4">
          {isAdmin && <div className="mb-3"><SetupProgressStrip event={event} onGo={(t) => setParams({ tab: t })} /></div>}
          {isAdmin && (
            <Card className="rounded-2xl border-border mb-3" data-testid="event-registration-share">
              <CardContent className="py-4 flex flex-wrap items-center gap-4">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(`${window.location.origin}/register/${eventId}`)}`}
                  alt="Registration QR"
                  className="rounded-xl border border-border bg-white p-1.5 w-32 h-32"
                  data-testid="event-registration-qr"
                />
                <div className="flex-1 min-w-[200px] space-y-1.5">
                  <p className="font-semibold text-foreground">Family registration</p>
                  <p className="text-xs text-muted-foreground">
                    Parents scan (or tap the link) to register — the athlete lands on this
                    roster grouped by age, evaluation-ready. Print the QR for the check-in table.
                  </p>
                  <p className="text-xs font-mono break-all text-info">{`${window.location.origin}/register/${eventId}`}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs"
                      onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/register/${eventId}`); toast.success("Registration link copied."); }}
                      data-testid="event-registration-copy">
                      Copy link
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs"
                      onClick={() => window.open(`https://api.qrserver.com/v1/create-qr-code/?size=800x800&data=${encodeURIComponent(`${window.location.origin}/register/${eventId}`)}`, "_blank")}>
                      Open big QR (print)
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          {isStaffView && <div className="mb-3"><StaffingPanel eventId={eventId} /></div>}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "Players", value: event.player_count, icon: Users },
              { label: "Checked In", value: event.checked_in_count, icon: CheckCircle2 },
              { label: "Evaluators", value: event.evaluator_count, icon: ClipboardList },
              { label: "Stations", value: event.station_count, icon: Layers },
              { label: "Groups", value: event.group_count, icon: Layers },
            ].map((s) => (
              <Card key={s.label} className="rounded-2xl border-border"><CardContent className="py-4 text-center">
                <p className="text-2xl font-bold font-mono-num text-foreground">{s.value ?? 0}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </CardContent></Card>
            ))}
          </div>
          {event.description && <Card className="rounded-2xl border-border mt-3"><CardContent className="py-4 text-sm text-muted-foreground">{event.description}</CardContent></Card>}
          {(event.age_groups || []).length > 0 && (
            <div className="flex gap-2 mt-3">{event.age_groups.map((a) => <span key={a} className="rounded-full bg-card border px-3 py-1 text-xs font-semibold text-foreground">{a}</span>)}</div>
          )}
          {isAdmin && (
            <div className="mt-8 rounded-2xl border border-border bg-card p-4" data-testid="event-danger-zone">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Danger zone</p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground max-w-md">
                  Deleting removes this event, its roster links, groups, stations, and assignments.
                  Athlete profiles are never touched. Submitted evaluations block deletion.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                  disabled={event.status === "Evaluation Active"}
                  data-testid="event-delete-button"
                  onClick={() => {
                    const ok = window.confirm(
                      `Delete "${event.name}"?\n\nThis removes the event, its roster links, groups, stations, and assignments. Athlete profiles are never touched. Submitted evaluations block deletion.`);
                    if (!ok) return;
                    api.delete(`/events/${eventId}`)
                      .then(() => { toast.success("Event deleted."); navigate("/events"); })
                      .catch((e) => {
                        // Submitted evaluations block a plain delete — the owner
                        // can force it after a second, explicit confirmation.
                        if (e?.response?.status === 409 && user?.role === "owner") {
                          const force = window.confirm(
                            `${errMsg(e)}\n\nForce delete anyway? This permanently removes the event AND its submitted evaluations.`);
                          if (!force) return;
                          api.delete(`/events/${eventId}?force=true`)
                            .then(() => { toast.success("Event force-deleted."); navigate("/events"); })
                            .catch((e2) => toast.error(errMsg(e2)));
                          return;
                        }
                        toast.error(errMsg(e));
                      });
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-1" /> Delete event
                </Button>
              </div>
              {event.status === "Evaluation Active" && (
                <p className="mt-1 text-[11px] text-warning" data-testid="event-delete-hint">Pause the evaluation before deleting.</p>
              )}
            </div>
          )}
        </TabsContent>

        {isStaffView && (
          <>
            <TabsContent value="roster" className="mt-4"><RosterTab eventId={eventId} isAdmin={isAdmin} eventName={event?.name} /></TabsContent>
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
