import { useEffect, useState } from "react";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Building2, ShieldCheck, KeyRound, AlertTriangle } from "lucide-react";

export default function Settings() {
  const { user } = useAuth();
  const [org, setOrg] = useState(null);
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [busy, setBusy] = useState(false);
  const [purging, setPurging] = useState(false);
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
        <h1 className="font-display text-4xl text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Organization and account settings.</p>
      </div>

      <Card className="rounded-2xl border-border">
        <CardContent className="pt-5 pb-5 space-y-4">
          <p className="font-semibold text-foreground flex items-center gap-2"><Building2 className="h-4 w-4" /> Organization</p>
          <div className="space-y-1">
            <Label className="text-xs">Organization name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!isOwner} className="h-11 rounded-xl" data-testid="org-name-input" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tagline</Label>
            <Input value={tagline} onChange={(e) => setTagline(e.target.value)} disabled={!isOwner} className="h-11 rounded-xl" data-testid="org-tagline-input" />
          </div>
          {isOwner && <Button onClick={save} disabled={busy} className="rounded-xl bg-primary hover:bg-brand-secondary h-11" data-testid="org-save-button">{busy ? "Saving…" : "Save Changes"}</Button>}
          {!isOwner && <p className="text-xs text-muted-foreground">Only the organization owner can edit these settings.</p>}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardContent className="pt-5 pb-5 space-y-2">
          <p className="font-semibold text-foreground flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Privacy & Feature Flags</p>
          <div className="space-y-1.5 text-sm text-muted-foreground">
            <p>• Player profiles are private and staff-only by default.</p>
            <p>• Media uploads require verified consent (minor athlete protection).</p>
            <p>• Rankings and reports are internal only — never public.</p>
            <p>• Coach AI training plans: <span className="font-semibold text-muted-foreground">Coming Soon</span> — drafts require human coach approval before athletes see them</p>
            <p>• Athlete portal: <span className="font-semibold text-muted-foreground">Coming Soon</span></p>
            <p>• Parent portal: <span className="font-semibold text-muted-foreground">Coming Soon</span></p>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardContent className="pt-5 pb-5 space-y-2">
          <p className="font-semibold text-foreground flex items-center gap-2"><KeyRound className="h-4 w-4" /> Account</p>
          <p className="text-sm text-muted-foreground">Signed in as <span className="font-semibold">{user?.full_name}</span> ({user?.email})</p>
          <p className="text-xs text-muted-foreground">To change your password, use “Forgot password” on the sign-in page. Sessions expire automatically after 7 days.</p>
        </CardContent>
      </Card>

      {isOwner && (
        <Card className="rounded-2xl border-destructive/40" data-testid="danger-zone">
          <CardContent className="pt-5 pb-5 space-y-3">
            <p className="font-semibold text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Danger Zone
            </p>
            <div className="space-y-1.5 text-sm text-muted-foreground">
              <p><span className="font-semibold text-foreground">Remove all athletes</span> from{" "}
                <span className="font-semibold text-foreground">{org?.name || "this organization"}</span>{" "}
                — deletes every athlete plus their evaluations, measurements, media, notes, goals,
                seasons and event roster spots.</p>
              <p>Staff accounts, events, stations and templates are kept. Other organizations are
                never affected.{" "}
                <span className="text-destructive font-semibold">This cannot be undone.</span></p>
            </div>
            <Button
              variant="outline"
              className="rounded-xl border-destructive/50 text-destructive hover:bg-destructive/10"
              disabled={purging}
              data-testid="purge-athletes-button"
              onClick={async () => {
                const typed = window.prompt(
                  `This permanently deletes EVERY athlete in ${org?.name || "this organization"} and all their evaluation history.\n\nType DELETE ALL ATHLETES to confirm:`);
                if (typed !== "DELETE ALL ATHLETES") {
                  if (typed !== null) toast.error("Confirmation text did not match — nothing was deleted.");
                  return;
                }
                setPurging(true);
                try {
                  const r = await api.post("/athletes/purge-all", null,
                    { params: { confirm: "DELETE ALL ATHLETES" } });
                  const n = r.data?.removed?.athletes ?? 0;
                  toast.success(`Removed ${n} athlete${n === 1 ? "" : "s"} and their records.`);
                } catch (e) {
                  toast.error(errMsg(e));
                } finally {
                  setPurging(false);
                }
              }}
            >
              {purging ? "Removing…" : "Remove all athletes"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
