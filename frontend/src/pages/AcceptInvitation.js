import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { AlertTriangle, Building2, IdCard, ShieldCheck } from "lucide-react";

const ROLE_LABELS = {
  owner: "Organization Owner", admin: "Administrator", head_scout: "Head Scout",
  coach: "Coach", evaluator: "Evaluator", athlete: "Athlete", parent: "Guardian",
};

/* Top-level (stable identity) so the password field keeps focus across re-renders. */
const Shell = ({ children }) => (
  <div className="min-h-screen bg-background flex flex-col hero-sweep">
    <div className="px-5 pt-5">
      <Link to="/" className="block hover:opacity-90 transition-opacity" data-testid="accept-invite-back-home">
        <p className="font-display text-xl text-foreground">60&apos;6&quot; ID</p>
        <p className="text-[10px] uppercase tracking-[0.14em] text-brand">Train. Elevate. Succeed.</p>
      </Link>
    </div>
    <div className="flex-1 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md relative z-10">{children}</div>
    </div>
  </div>
);

const PanelLabel = ({ children }) => (
  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>
);

/* "2026-09-02T…" → "Sep 2". Anything unparseable simply disappears. */
const fmtExpiry = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    if (!token) return;
    api.get(`/invitations/lookup/${token}`)
      .then((r) => { setInvite(r.data); setLookupFailed(false); })
      .catch(() => { setInvite(null); setLookupFailed(true); });
  }, [token]);

  const isAthleteInvite = invite?.role === "athlete" || invite?.role === "parent";
  const orgName = invite?.organization_name || "";
  const roleLabel = invite ? (ROLE_LABELS[invite.role] || invite.role) : "";
  const expiry = fmtExpiry(invite?.expires_at);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setSubmitError("");
    try {
      const u = await acceptInvite(token.trim(), password);
      toast.success(isAthleteInvite ? "Welcome — your ID is ready." : "Welcome to 60'6\"!");
      window.location.href = (u?.role === "athlete" || u?.role === "parent") ? "/my-id" : "/dashboard";
    } catch (err) {
      const msg = errMsg(err);
      setSubmitError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const headline = isAthleteInvite ? "Claim your ID" : "You're invited";
  const subhead = (() => {
    if (!invite) return "Paste the invitation code from your email to get started.";
    if (invite.role === "parent") {
      return `${orgName || "This organization"} invited you to manage this athlete's My ID profile.`;
    }
    if (invite.role === "athlete") {
      return `${orgName || "This organization"} invited you to open your My ID — scores, growth, and profile.`;
    }
    return `${orgName || "This organization"} invited you to join their staff as ${roleLabel}.`;
  })();

  return (
    <Shell>
      <div className="flex flex-col items-center text-center mb-8">
        <div className="h-12 w-12 rounded-xl grid place-items-center bg-brand/15 text-brand mb-3">
          {isAthleteInvite ? <IdCard className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
        </div>
        <h1 className="font-display text-4xl sm:text-5xl text-foreground">{headline}</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-xs">{subhead}</p>
      </div>

      <Card className="rounded-2xl border-border bg-card">
        <CardContent className="pt-6 pb-6">
          <form onSubmit={submit} className="space-y-4">
            {!tokenParam && (
              <div className="space-y-1.5">
                <Label htmlFor="invite-token">Invitation code</Label>
                <Input
                  id="invite-token"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="h-12 rounded-xl font-mono-num"
                  data-testid="invite-token-input"
                  placeholder="Paste your invitation code"
                />
                <p className="text-xs text-muted-foreground">It is in the invitation email, at the end of the link.</p>
              </div>
            )}

            {invite && (
              <div className="rounded-xl border border-border bg-secondary/60 px-4 py-3.5 space-y-2.5" data-testid="invite-details">
                <PanelLabel>Your invitation</PanelLabel>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg grid place-items-center shrink-0 bg-card text-brand">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{invite.full_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{invite.email}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-1.5 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground shrink-0">Organization</span>
                    <span className="min-w-0 truncate font-semibold text-foreground">{orgName || "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground shrink-0">Role</span>
                    <span className="min-w-0 truncate rounded-full border border-brand/40 bg-brand/15 px-2.5 py-0.5 text-xs font-semibold text-brand">
                      {roleLabel}
                    </span>
                  </div>
                  {expiry && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground shrink-0">Expires</span>
                      <span className="min-w-0 truncate text-xs font-semibold text-foreground">{expiry}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {lookupFailed && token && (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5" data-testid="invite-error">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
                <p className="min-w-0 text-sm font-semibold text-destructive">Invitation not found, already used, or expired.</p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="invite-password">Set your password</Label>
              <Input
                id="invite-password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 rounded-xl"
                data-testid="invite-password-input"
                placeholder="Minimum 8 characters"
              />
              <p className="text-xs text-muted-foreground">
                Already have a 60&apos;6&quot; account with this email? Enter that account&apos;s current password instead
                and this invitation is added to it.
              </p>
            </div>

            {submitError && (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5" data-testid="accept-invite-error">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
                <p className="min-w-0 text-sm font-semibold text-destructive">{submitError}</p>
              </div>
            )}

            <Button
              type="submit"
              disabled={busy || !invite}
              className="w-full h-12 rounded-full bg-brand hover:bg-brand-secondary text-base font-semibold active:scale-[0.98] transition"
              data-testid="accept-invite-submit-button"
            >
              {busy ? "Creating account…" : isAthleteInvite ? "Open My ID" : "Accept Invitation"}
            </Button>
          </form>

          <div className="mt-4 text-center space-y-2">
            <Link to="/signin" className="block text-sm text-info hover:underline">Already have an account? Sign in</Link>
            <Link to="/" className="block text-sm text-muted-foreground hover:text-foreground">← Back to home</Link>
          </div>
        </CardContent>
      </Card>
    </Shell>
  );
}
