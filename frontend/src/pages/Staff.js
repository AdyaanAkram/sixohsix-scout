import { useCallback, useEffect, useState } from "react";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { MailWarning, Search, UserCog, UserPlus, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const ROLE_LABELS = { owner: "Organization Owner", admin: "Administrator", head_scout: "Head Scout", coach: "Coach", evaluator: "Evaluator", athlete: "Athlete", parent: "Guardian" };
const INVITABLE = ["admin", "head_scout", "coach", "evaluator"];

const PanelLabel = ({ children }) => (
  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>
);

/* Role pill — brand tint while the membership is active, muted once it is not. */
const RolePill = ({ role, active }) => (
  <span className={cn(
    "shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
    active ? "border-brand/40 bg-brand/15 text-brand" : "border-border bg-secondary text-muted-foreground"
  )}>
    {ROLE_LABELS[role] || role}{!active && " · inactive"}
  </span>
);

const initials = (name) => (name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("");

export default function Staff() {
  const [staffSearch, setStaffSearch] = useState("");
  const { user } = useAuth();
  const [staff, setStaff] = useState(null);
  const [invitations, setInvitations] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", full_name: "", role: "evaluator" });
  const [inviteResult, setInviteResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = ["owner", "admin"].includes(user?.role);

  const load = useCallback(() => {
    api.get("/staff").then((r) => setStaff(r.data)).catch((e) => { toast.error(errMsg(e)); setStaff([]); });
    if (isAdmin) api.get("/invitations").then((r) => setInvitations(r.data.filter((i) => i.status === "pending")));
  }, [isAdmin]);
  useEffect(() => { load(); }, [load]);

  const invite = async () => {
    setBusy(true);
    try {
      const r = await api.post("/staff/invite", form);
      setInviteResult(r.data);
      // An existing account is added straight away — there is no invite to accept.
      toast.success(r.data?.mode === "added"
        ? `${r.data.full_name || r.data.email} added to your staff.`
        : "Invitation emailed.");
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const updateStaff = async (userId, patch) => {
    try {
      await api.patch(`/staff/${userId}`, patch);
      toast.success("Staff member updated.");
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!staff) return <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>;

  const query = staffSearch.trim().toLowerCase();
  const visibleStaff = query
    ? staff.filter((s) =>
        ["coach", "evaluator"].includes(s.role) &&
        `${s.full_name || ""} ${s.email || ""}`.toLowerCase().includes(query))
    : staff;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-11 w-11 rounded-xl grid place-items-center shrink-0 bg-brand/15 text-brand">
            <UserCog className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-3xl sm:text-4xl text-foreground">Staff</h1>
            <p className="text-sm text-muted-foreground">
              {staff.length} {staff.length === 1 ? "member" : "members"}
              {invitations.length > 0 && ` · ${invitations.length} pending`}
            </p>
          </div>
        </div>
        {isAdmin && (
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setInviteResult(null); setForm({ email: "", full_name: "", role: "evaluator" }); } }}>
            <DialogTrigger asChild>
              <Button className="rounded-xl bg-primary hover:bg-brand-secondary h-11" data-testid="invite-staff-button"><UserPlus className="h-4 w-4 mr-1" /> Invite Staff</Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl max-w-sm">
              <DialogHeader><DialogTitle className="font-display text-2xl text-foreground">Invite Staff Member</DialogTitle></DialogHeader>
              {!inviteResult ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="invite-name">Full name *</Label>
                    <Input id="invite-name" value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} className="h-11 rounded-xl" data-testid="invite-name-input" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="invite-email">Email *</Label>
                    <Input id="invite-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="h-11 rounded-xl" data-testid="invite-email-input" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Role</Label>
                    <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
                      <SelectTrigger className="h-11 rounded-xl" data-testid="invite-role-select"><SelectValue /></SelectTrigger>
                      <SelectContent>{INVITABLE.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Button className="w-full rounded-xl bg-primary hover:bg-brand-secondary h-11" disabled={busy || !form.email || !form.full_name} onClick={invite} data-testid="invite-submit-button">
                    {busy ? "Creating…" : "Create Invitation"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3" data-testid="invite-result">
                  <p className="text-sm text-muted-foreground">
                    {inviteResult.mode === "added" ? (
                      <>
                        <span className="font-semibold">{inviteResult.full_name || inviteResult.email}</span> already had a
                        60&apos;6&quot; account, so they were added to your staff right away — no invitation to accept.
                        They keep any family profile they already had.
                      </>
                    ) : (
                      <>
                        Invitation emailed to <span className="font-semibold">{inviteResult.email}</span>.
                        {inviteResult.expires_at ? " Link expires in 14 days." : ""}
                      </>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">In local/dev, the accept link is printed in the backend console (tokens are never returned by the API).</p>
                  <Button className="w-full rounded-xl bg-primary hover:bg-brand-secondary h-11" onClick={() => { setOpen(false); setInviteResult(null); }} data-testid="invite-done-button">Done</Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        )}
      </div>

      {invitations.length > 0 && (
        <Card className="rounded-2xl border-warning/40 bg-warning/10">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <MailWarning className="h-4 w-4 shrink-0 text-warning" />
              <PanelLabel>Pending invitations</PanelLabel>
            </div>
            <div className="mt-3 space-y-2">
              {invitations.map((i) => (
                <div key={i.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
                  <div className="flex-1 min-w-[150px]">
                    <p className="text-sm font-semibold text-foreground truncate">{i.full_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{i.email}</p>
                  </div>
                  <RolePill role={i.role} active />
                  <span className="flex items-center gap-1.5 shrink-0">
                    <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs"
                      onClick={async () => {
                        try { const r = await api.post(`/invitations/${i.id}/resend`, {}); toast.success(`Invitation re-emailed to ${r.data.email}`); }
                        catch (e) { toast.error(errMsg(e)); }
                      }} data-testid={`invite-resend-${i.id}`}>
                      Resend
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs"
                      onClick={async () => {
                        const email = window.prompt(`Send this invitation to a different email:`, i.email);
                        if (!email || email === i.email) return;
                        try { const r = await api.post(`/invitations/${i.id}/resend`, { email }); toast.success(`Invitation sent to ${r.data.email}`); load(); }
                        catch (e) { toast.error(errMsg(e)); }
                      }} data-testid={`invite-edit-${i.id}`}>
                      Edit email
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 rounded-lg text-xs text-muted-foreground hover:text-destructive"
                      onClick={async () => {
                        if (!window.confirm(`Cancel the invitation to ${i.full_name}? The link stops working.`)) return;
                        try { await api.delete(`/invitations/${i.id}`); toast.success("Invitation cancelled."); load(); }
                        catch (e) { toast.error(errMsg(e)); }
                      }} data-testid={`invite-cancel-${i.id}`}>
                      Cancel
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={staffSearch}
          onChange={(e) => setStaffSearch(e.target.value)}
          placeholder="Search coaches & evaluators…"
          className="h-11 rounded-xl pl-9"
          data-testid="staff-search-input"
        />
      </div>

      {visibleStaff.length === 0 ? (
        <EmptyState
          icon={Users}
          title={query ? "No coaches or evaluators match that search" : "No staff yet"}
          hint={query ? "Search covers coaches and evaluators by name or email." : "Invite an administrator, head scout, coach, or evaluator to get started."}
        />
      ) : (
        <div className="space-y-2">
          {visibleStaff.map((s) => (
            <Card key={s.id} className="rounded-2xl border-border bg-card">
              <CardContent className="py-3.5 flex flex-wrap items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-brand/15 text-brand grid place-items-center font-bold text-sm shrink-0">
                  {initials(s.full_name)}
                </div>
                <div className="flex-1 min-w-[150px]">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {s.full_name} {s.id === user?.id && <span className="text-xs text-muted-foreground font-normal">(you)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{s.email}</p>
                </div>
                <RolePill role={s.role} active={s.membership_active} />
                {isAdmin && s.role !== "owner" && s.id !== user?.id && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={s.role} onValueChange={(v) => updateStaff(s.id, { role: v })}>
                      <SelectTrigger className="h-9 w-[140px] rounded-lg text-xs" data-testid={`staff-role-select-${s.id}`}><SelectValue /></SelectTrigger>
                      <SelectContent>{INVITABLE.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" className="rounded-lg h-9 text-xs" onClick={() => updateStaff(s.id, { active: !s.membership_active })} data-testid={`staff-toggle-active-${s.id}`}>
                      {s.membership_active ? "Deactivate" : "Reactivate"}
                    </Button>
                    {user?.role === "owner" && (
                      <Button size="sm" variant="outline" className="rounded-lg h-9 text-xs text-destructive hover:bg-destructive/10"
                        data-testid={`staff-remove-${s.id}`}
                        onClick={() => {
                          if (!window.confirm(`Remove ${s.full_name} from the organization?\n\nTheir access here ends immediately. This does not delete any evaluations they submitted.`)) return;
                          api.delete(`/staff/${s.id}`)
                            .then(() => { toast.success("Staff member removed."); load(); })
                            .catch((e) => toast.error(errMsg(e)));
                        }}>
                        Remove
                      </Button>
                    )}
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
