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
import { ShieldCheck } from "lucide-react";

const ROLE_LABELS = { owner: "Organization Owner", admin: "Administrator", head_scout: "Head Scout", coach: "Coach", evaluator: "Evaluator" };

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

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await acceptInvite(token.trim(), password);
      toast.success("Welcome to PBG Scout!");
      window.location.href = "/";
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 hero-sweep">
      <div className="w-full max-w-md">
        <Card className="rounded-2xl card-shadow border-[#E7E1D6]">
          <CardContent className="pt-6 pb-6">
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck className="h-5 w-5 text-[#0B1E3A]" />
              <h1 className="font-display text-3xl text-[#0B1E3A]">Join PBG Scout</h1>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Invitation token</Label>
                <Input required value={token} onChange={(e) => setToken(e.target.value)} className="h-12 rounded-xl font-mono-num" data-testid="invite-token-input" placeholder="Paste your invitation token" />
              </div>
              {invite && (
                <div className="rounded-xl bg-[hsl(var(--secondary))] px-4 py-3 space-y-1" data-testid="invite-details">
                  <p className="text-sm font-semibold text-[#0B1E3A]">{invite.full_name}</p>
                  <p className="text-xs text-slate-600">{invite.email}</p>
                  <div className="flex gap-2 pt-1">
                    <Badge variant="outline" className="bg-white">{ROLE_LABELS[invite.role] || invite.role}</Badge>
                    <Badge variant="outline" className="bg-white">{invite.organization_name}</Badge>
                  </div>
                </div>
              )}
              {lookupFailed && token && (
                <p className="text-sm text-[#C81D25]" data-testid="invite-error">Invitation not found or already used.</p>
              )}
              <div className="space-y-1.5">
                <Label>Create password</Label>
                <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 rounded-xl" data-testid="invite-password-input" placeholder="Minimum 8 characters" />
              </div>
              <Button type="submit" disabled={busy || !invite} className="w-full h-12 rounded-xl bg-[#0B1E3A] hover:bg-[#102A4F]" data-testid="accept-invite-submit-button">
                {busy ? "Creating account…" : "Accept Invitation"}
              </Button>
            </form>
            <div className="mt-4 text-center">
              <Link to="/signin" className="text-sm text-[#1F4AA8] hover:underline">Already have an account? Sign in</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
