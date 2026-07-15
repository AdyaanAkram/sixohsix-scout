import { useCallback, useEffect, useState } from "react";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { UserPlus, Copy, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";

const ROLE_LABELS = { owner: "Organization Owner", admin: "Administrator", head_scout: "Head Scout", coach: "Coach", evaluator: "Evaluator", athlete: "Athlete (portal coming soon)", parent: "Parent (portal coming soon)" };
const INVITABLE = ["admin", "head_scout", "coach", "evaluator"];

export default function Staff() {
  const { user } = useAuth();
  const [staff, setStaff] = useState(null);
  const [invitations, setInvitations] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", full_name: "", role: "evaluator" });
  const [inviteResult, setInviteResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = ["owner", "admin"].includes(user?.role);

  const load = useCallback(() => {
    api.get("/staff").then((r) => setStaff(r.data));
    if (isAdmin) api.get("/invitations").then((r) => setInvitations(r.data.filter((i) => i.status === "pending")));
  }, [isAdmin]);
  useEffect(load, [load]);

  const invite = async () => {
    setBusy(true);
    try {
      const r = await api.post("/staff/invite", form);
      setInviteResult(r.data);
      toast.success("Invitation created.");
      load();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  const copyLink = (token) => {
    const link = `${window.location.origin}/accept-invitation?token=${token}`;
    navigator.clipboard.writeText(link);
    toast.success("Invitation link copied. Share it with the new staff member.");
  };

  const updateStaff = async (userId, patch) => {
    try {
      await api.patch(`/staff/${userId}`, patch);
      toast.success("Staff member updated.");
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!staff) return <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl text-[#0B1E3A]">Staff</h1>
          <p className="text-sm text-slate-500">{staff.length} members</p>
        </div>
        {isAdmin && (
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setInviteResult(null); setForm({ email: "", full_name: "", role: "evaluator" }); } }}>
            <DialogTrigger asChild>
              <Button className="rounded-xl bg-[#0B1E3A] hover:bg-[#102A4F] h-11" data-testid="invite-staff-button"><UserPlus className="h-4 w-4 mr-1" /> Invite Staff</Button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl max-w-sm">
              <DialogHeader><DialogTitle className="font-display text-2xl text-[#0B1E3A]">Invite Staff Member</DialogTitle></DialogHeader>
              {!inviteResult ? (
                <div className="space-y-3">
                  <div className="space-y-1"><Label className="text-xs">Full name *</Label><Input value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} className="h-10 rounded-lg" data-testid="invite-name-input" /></div>
                  <div className="space-y-1"><Label className="text-xs">Email *</Label><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="h-10 rounded-lg" data-testid="invite-email-input" /></div>
                  <div className="space-y-1">
                    <Label className="text-xs">Role</Label>
                    <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
                      <SelectTrigger className="h-10 rounded-lg" data-testid="invite-role-select"><SelectValue /></SelectTrigger>
                      <SelectContent>{INVITABLE.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Button className="w-full rounded-xl bg-[#0B1E3A] h-11" disabled={busy || !form.email || !form.full_name} onClick={invite} data-testid="invite-submit-button">
                    {busy ? "Creating…" : "Create Invitation"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3" data-testid="invite-result">
                  <p className="text-sm text-slate-600">Invitation created for <span className="font-semibold">{inviteResult.invitation.email}</span>. Share this secure link:</p>
                  <div className="rounded-xl bg-[hsl(var(--secondary))] px-3 py-2.5 text-xs font-mono-num break-all">{`${window.location.origin}/accept-invitation?token=${inviteResult.invite_token}`}</div>
                  <Button className="w-full rounded-xl bg-[#0B1E3A] h-11" onClick={() => copyLink(inviteResult.invite_token)} data-testid="invite-copy-link"><Copy className="h-4 w-4 mr-1" /> Copy Link</Button>
                </div>
              )}
            </DialogContent>
          </Dialog>
        )}
      </div>

      {invitations.length > 0 && (
        <Card className="rounded-2xl border-[#FFD9A3] bg-[#FFF7E6]/50">
          <CardContent className="py-4">
            <p className="text-sm font-semibold text-[#7C2D12] mb-2">Pending invitations</p>
            <div className="space-y-1.5">
              {invitations.map((i) => (
                <div key={i.id} className="flex items-center justify-between text-sm">
                  <span>{i.full_name} · {i.email} · {ROLE_LABELS[i.role]}</span>
                  <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => copyLink(i.token)}><Copy className="h-3 w-3 mr-1" /> Copy link</Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {staff.map((s) => (
          <Card key={s.id} className="rounded-2xl border-[#E7E1D6]">
            <CardContent className="py-3.5 flex flex-wrap items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-[#102A4F] text-white flex items-center justify-center font-bold text-sm">
                {(s.full_name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("")}
              </div>
              <div className="flex-1 min-w-[150px]">
                <p className="text-sm font-semibold text-[#0B1E3A]">{s.full_name} {s.id === user?.id && <span className="text-xs text-slate-400 font-normal">(you)</span>}</p>
                <p className="text-xs text-slate-500">{s.email}</p>
              </div>
              <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-semibold", s.membership_active ? "bg-[#E6F0FF] text-[#102A4F] border-[#BBD6FF]" : "bg-slate-100 text-slate-500")}>
                {ROLE_LABELS[s.role] || s.role}{!s.membership_active && " · inactive"}
              </span>
              {isAdmin && s.role !== "owner" && s.id !== user?.id && (
                <div className="flex gap-2">
                  <Select value={s.role} onValueChange={(v) => updateStaff(s.id, { role: v })}>
                    <SelectTrigger className="h-9 w-[140px] rounded-lg text-xs" data-testid={`staff-role-select-${s.id}`}><SelectValue /></SelectTrigger>
                    <SelectContent>{INVITABLE.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" className="rounded-lg h-9 text-xs" onClick={() => updateStaff(s.id, { active: !s.membership_active })} data-testid={`staff-toggle-active-${s.id}`}>
                    {s.membership_active ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
