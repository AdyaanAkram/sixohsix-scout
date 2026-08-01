import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ShieldCheck, IdCard } from "lucide-react";

const ROLE_LABELS = {
  owner: "Organization Owner", admin: "Administrator", head_scout: "Head Scout",
  coach: "Coach", evaluator: "Evaluator", athlete: "Athlete", parent: "Guardian",
};

export default function AcceptInvitation() {
  const [params] = useSearchParams();
  const tokenParam = params.get("token") || "";
  const { acceptInvite } = useAuth();
  const [token, setToken] = useState(tokenParam);
  const [invite, setInvite] = useState(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [lookupFailed, setLookupFailed] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.get(`/invitations/lookup/${token}`)
      .then((r) => { setInvite(r.data); setLookupFailed(false); })
      .catch(() => { setInvite(null); setLookupFailed(true); });
  }, [token]);

  const isAthleteInvite = invite?.role === "athlete" || invite?.role === "parent";

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await acceptInvite(token.trim(), password);
      toast.success(isAthleteInvite ? "Welcome — your ID is ready." : "Welcome to 60'6\"!");
      window.location.href = (u?.role === "athlete" || u?.role === "parent") ? "/my-id" : "/dashboard";
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 hero-sweep">
      <div className="w-full max-w-md">
        <Card className="rounded-2xl border-border bg-card">
          <CardContent className="pt-6 pb-6">
            <div className="flex items-center gap-2 mb-2">
              {isAthleteInvite ? <IdCard className="h-5 w-5 text-brand" /> : <ShieldCheck className="h-5 w-5 text-foreground" />}
              <h1 className="font-display text-3xl text-foreground">
                {isAthleteInvite ? "Claim your ID" : "Join 60'6\""}
              </h1>
            </div>
            {isAthleteInvite && (
              <p className="text-sm text-muted-foreground mb-4">
                {invite.role === "parent"
                  ? "Create a guardian account to manage this athlete's My ID profile."
                  : "Set a password to open your My ID — scores, growth, and profile."}
              </p>
            )}
            <form onSubmit={submit} className="space-y-4">
              {!tokenParam && (
                <div className="space-y-1.5">
                  <Label>Invitation token</Label>
                  <Input required value={token} onChange={(e) => setToken(e.target.value)} className="h-12 rounded-xl font-mono-num" data-testid="invite-token-input" placeholder="Paste your invitation token" />
                </div>
              )}
              {invite && (
                <div className="rounded-xl bg-secondary px-4 py-3 space-y-1" data-testid="invite-details">
                  <p className="text-sm font-semibold text-foreground">{invite.full_name}</p>
                  <p className="text-xs text-muted-foreground">{invite.email}</p>
                  <div className="flex gap-2 pt-1 flex-wrap">
                    <Badge variant="outline" className="bg-card">{ROLE_LABELS[invite.role] || invite.role}</Badge>
                    <Badge variant="outline" className="bg-card">{invite.organization_name}</Badge>
                  </div>
                </div>
              )}
              {lookupFailed && token && (
                <p className="text-sm text-destructive" data-testid="invite-error">Invitation not found, already used, or expired.</p>
              )}
              <div className="space-y-1.5">
                <Label>Create password</Label>
                <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 rounded-xl" data-testid="invite-password-input" placeholder="Minimum 8 characters" />
              </div>
              <Button type="submit" disabled={busy || !invite} className="w-full h-12 rounded-xl bg-primary hover:bg-brand-secondary" data-testid="accept-invite-submit-button">
                {busy ? "Creating account…" : isAthleteInvite ? "Open My ID" : "Accept Invitation"}
              </Button>
            </form>
            <div className="mt-4 text-center">
              <Link to="/signin" className="text-sm text-info hover:underline">Already have an account? Sign in</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
