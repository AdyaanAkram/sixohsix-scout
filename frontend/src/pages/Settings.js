import { useEffect, useState } from "react";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Building2, ShieldCheck, KeyRound } from "lucide-react";

export default function Settings() {
  const { user } = useAuth();
  const [org, setOrg] = useState(null);
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [busy, setBusy] = useState(false);
  const isOwner = user?.role === "owner";

  useEffect(() => {
    api.get("/organization").then((r) => {
      setOrg(r.data);
      setName(r.data?.name || "");
      setTagline(r.data?.tagline || "");
    });
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      await api.patch("/organization", { name, tagline });
      toast.success("Organization updated.");
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  if (!org) return <Skeleton className="h-64 rounded-2xl" />;

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="font-display text-4xl text-[#0B1E3A]">Settings</h1>
        <p className="text-sm text-slate-500">Organization and account settings.</p>
      </div>

      <Card className="rounded-2xl card-shadow border-[#E7E1D6]">
        <CardContent className="pt-5 pb-5 space-y-4">
          <p className="font-semibold text-[#0B1E3A] flex items-center gap-2"><Building2 className="h-4 w-4" /> Organization</p>
          <div className="space-y-1">
            <Label className="text-xs">Organization name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!isOwner} className="h-11 rounded-xl" data-testid="org-name-input" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tagline</Label>
            <Input value={tagline} onChange={(e) => setTagline(e.target.value)} disabled={!isOwner} className="h-11 rounded-xl" data-testid="org-tagline-input" />
          </div>
          {isOwner && <Button onClick={save} disabled={busy} className="rounded-xl bg-[#0B1E3A] hover:bg-[#102A4F] h-11" data-testid="org-save-button">{busy ? "Saving…" : "Save Changes"}</Button>}
          {!isOwner && <p className="text-xs text-slate-400">Only the organization owner can edit these settings.</p>}
        </CardContent>
      </Card>

      <Card className="rounded-2xl card-shadow border-[#E7E1D6]">
        <CardContent className="pt-5 pb-5 space-y-2">
          <p className="font-semibold text-[#0B1E3A] flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Privacy & Feature Flags</p>
          <div className="space-y-1.5 text-sm text-slate-600">
            <p>• Player profiles are private and staff-only by default.</p>
            <p>• Media uploads require verified consent (minor athlete protection).</p>
            <p>• Rankings and reports are internal only — never public.</p>
            <p>• Athlete portal: <span className="font-semibold text-slate-400">Coming Soon</span> (disabled by feature flag)</p>
            <p>• Parent portal: <span className="font-semibold text-slate-400">Coming Soon</span> (disabled by feature flag)</p>
            <p>• AI-assisted scouting tools: <span className="font-semibold text-slate-400">Coming Soon</span> (architecture ready, disabled)</p>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl card-shadow border-[#E7E1D6]">
        <CardContent className="pt-5 pb-5 space-y-2">
          <p className="font-semibold text-[#0B1E3A] flex items-center gap-2"><KeyRound className="h-4 w-4" /> Account</p>
          <p className="text-sm text-slate-600">Signed in as <span className="font-semibold">{user?.full_name}</span> ({user?.email})</p>
          <p className="text-xs text-slate-400">To change your password, use “Forgot password” on the sign-in page. Sessions expire automatically after 7 days.</p>
        </CardContent>
      </Card>
    </div>
  );
}
