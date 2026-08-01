import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, errMsg, signedUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Search, Plus, Upload, FileDown, Users, ChevronRight } from "lucide-react";

const AGE_GROUPS = ["8U", "9U", "10U", "11U", "12U", "13U", "14U", "15U", "16U", "17U", "18U"];
const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

const EMPTY_FORM = {
  first_name: "", last_name: "", preferred_name: "", date_of_birth: "", graduation_year: "",
  primary_position: "", bats: "", throws: "", height: "", weight: "", jersey_number: "",
  current_team: "", school: "", city: "", state: "", country: "USA",
  guardian_name: "", guardian_email: "", guardian_phone: "", emergency_contact: "",
};

const AddPlayerDialog = ({ onCreated }) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = { ...form, graduation_year: form.graduation_year ? parseInt(form.graduation_year) : null, secondary_positions: [] };
      Object.keys(payload).forEach((k) => { if (payload[k] === "") payload[k] = null; });
      await api.post("/athletes", payload);
      toast.success("Player added.");
      setOpen(false);
      setForm(EMPTY_FORM);
      onCreated();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const F = ({ label, k, type = "text", placeholder }) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={form[k]} onChange={set(k)} placeholder={placeholder} className="h-10 rounded-lg" data-testid={`add-player-${k.replace(/_/g, "-")}-input`} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="rounded-xl bg-primary hover:bg-brand-secondary h-11" data-testid="add-player-button">
          <Plus className="h-4 w-4 mr-1" /> Add Player
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl">
        <DialogHeader><DialogTitle className="font-display text-2xl text-foreground">Add Player</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <F label="First name *" k="first_name" />
            <F label="Last name *" k="last_name" />
            <F label="Preferred name" k="preferred_name" />
            <F label="Date of birth" k="date_of_birth" type="date" />
            <F label="Graduation year" k="graduation_year" type="number" />
            <div className="space-y-1">
              <Label className="text-xs">Primary position</Label>
              <Select value={form.primary_position || undefined} onValueChange={set("primary_position")}>
                <SelectTrigger className="h-10 rounded-lg" data-testid="add-player-position-select"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Bats</Label>
              <Select value={form.bats || undefined} onValueChange={set("bats")}>
                <SelectTrigger className="h-10 rounded-lg"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent><SelectItem value="R">Right</SelectItem><SelectItem value="L">Left</SelectItem><SelectItem value="S">Switch</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Throws</Label>
              <Select value={form.throws || undefined} onValueChange={set("throws")}>
                <SelectTrigger className="h-10 rounded-lg"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent><SelectItem value="R">Right</SelectItem><SelectItem value="L">Left</SelectItem></SelectContent>
              </Select>
            </div>
            <F label="Height" k="height" placeholder='e.g. 62 in' />
            <F label="Weight" k="weight" placeholder='e.g. 120 lb' />
            <F label="Team" k="current_team" />
            <F label="School" k="school" />
            <F label="City" k="city" />
            <F label="State" k="state" />
            <F label="Guardian name" k="guardian_name" />
            <F label="Guardian email" k="guardian_email" type="email" />
            <F label="Guardian phone" k="guardian_phone" />
            <F label="Emergency contact" k="emergency_contact" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !form.first_name || !form.last_name} className="rounded-xl bg-primary hover:bg-brand-secondary w-full h-11" data-testid="add-player-submit-button">
              {busy ? "Adding…" : "Add Player"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default function PlayersList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [ageGroup, setAgeGroup] = useState("all");
  const [position, setPosition] = useState("all");
  const [status, setStatus] = useState("active");
  const isAdmin = ["owner", "admin"].includes(user?.role);

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (search) params.search = search;
    if (ageGroup !== "all") params.age_group = ageGroup;
    if (position !== "all") params.position = position;
    if (status !== "all") params.status = status;
    api.get("/athletes", { params }).then((r) => setPlayers(r.data)).finally(() => setLoading(false));
  }, [search, ageGroup, position, status]);

  useEffect(() => {
    const t = setTimeout(load, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl text-foreground">Players</h1>
          <p className="text-sm text-muted-foreground">{players.length} player{players.length === 1 ? "" : "s"} in the directory</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" className="rounded-xl h-11" onClick={() => navigate("/players/import")} data-testid="import-players-button">
              <Upload className="h-4 w-4 mr-1" /> Import CSV
            </Button>
            <Button variant="outline" className="rounded-xl h-11" onClick={() => window.open(signedUrl("/athletes-export/csv"), "_blank")} data-testid="export-players-button">
              <FileDown className="h-4 w-4 mr-1" /> Export
            </Button>
            <AddPlayerDialog onCreated={load} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name…" className="pl-9 h-11 rounded-xl bg-card" data-testid="players-search-input" />
        </div>
        <Select value={ageGroup} onValueChange={setAgeGroup}>
          <SelectTrigger className="w-[110px] h-11 rounded-xl bg-card" data-testid="players-filter-age-group"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All ages</SelectItem>{AGE_GROUPS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={position} onValueChange={setPosition}>
          <SelectTrigger className="w-[120px] h-11 rounded-xl bg-card" data-testid="players-filter-position"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All positions</SelectItem>{POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[120px] h-11 rounded-xl bg-card" data-testid="players-filter-status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
      ) : players.length === 0 ? (
        <EmptyState icon={Users} title="No players found" hint="Adjust your filters, or add players manually or via CSV import." />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {players.map((p) => (
              <Link key={p.id} to={`/players/${p.id}`} data-testid={`player-card-${p.id}`}>
                <Card className="rounded-2xl border-border mb-2 active:scale-[0.99] transition">
                  <CardContent className="py-3.5 flex items-center gap-3">
                    <PlayerAvatar firstName={p.first_name} lastName={p.last_name} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground truncate">{p.first_name} {p.last_name}</p>
                      <p className="text-xs text-muted-foreground">{p.age_group || "—"} · {p.primary_position || "—"} · {p.current_team || "No team"}</p>
                    </div>
                    <StatusBadge status={p.status} />
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          {/* Desktop table */}
          <Card className="hidden md:block rounded-2xl border-border overflow-hidden">
            <Table data-testid="players-table">
              <TableHeader>
                <TableRow className="bg-secondary">
                  <TableHead>Player</TableHead>
                  <TableHead>Age Group</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>B/T</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {players.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-secondary" onClick={() => navigate(`/players/${p.id}`)} data-testid={`player-row-${p.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <PlayerAvatar firstName={p.first_name} lastName={p.last_name} size="sm" />
                        <span className="font-semibold text-foreground">{p.first_name} {p.last_name}</span>
                      </div>
                    </TableCell>
                    <TableCell>{p.age_group || "—"}</TableCell>
                    <TableCell>{p.primary_position || "—"}</TableCell>
                    <TableCell className="font-mono-num text-xs">{p.bats || "—"}/{p.throws || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{p.current_team || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{p.city ? `${p.city}, ${p.state}` : "—"}</TableCell>
                    <TableCell><StatusBadge status={p.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
