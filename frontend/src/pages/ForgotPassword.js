import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, KeyRound } from "lucide-react";

/* Top-level (stable identity) so the inputs keep focus across re-renders. */
const Shell = ({ children }) => (
  <div className="min-h-screen bg-background flex flex-col hero-sweep">
    <div className="px-5 pt-5">
      <Link to="/" className="block hover:opacity-90 transition-opacity" data-testid="forgot-back-home">
        <p className="font-display text-xl text-foreground">60&apos;6&quot; ID</p>
        <p className="text-[10px] uppercase tracking-[0.14em] text-brand">Train. Elevate. Succeed.</p>
      </Link>
    </div>
    <div className="flex-1 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md relative z-10">{children}</div>
    </div>
  </div>
);

export default function ForgotPassword() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestedFor, setRequestedFor] = useState("");

  useEffect(() => {
    const t = params.get("token");
    if (t) {
      setResetToken(t);
      setSent(true);
    }
  }, [params]);

  const request = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post("/auth/forgot-password", { email: email.trim() });
      setSent(true);
      setRequestedFor(email.trim());
      if (r.data.reset_token) setResetToken(r.data.reset_token);
      toast.success("Reset request created.");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token: resetToken.trim(), password: newPassword });
      toast.success("Password updated. Sign in with your new password.");
      window.location.href = "/signin";
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div className="flex flex-col items-center text-center mb-8">
        <div className="h-12 w-12 rounded-xl grid place-items-center bg-brand/15 text-brand mb-3">
          <KeyRound className="h-6 w-6" />
        </div>
        <h1 className="font-display text-4xl sm:text-5xl text-foreground">Reset password</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-xs">
          {sent
            ? "Enter the reset token and choose a new password."
            : "We will create a reset token for your 60'6\" ID account."}
        </p>
      </div>

      <Card className="rounded-2xl border-border bg-card">
        <CardContent className="pt-6 pb-6">
          {!sent ? (
            <form onSubmit={request} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@606athletics.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 rounded-xl"
                  data-testid="forgot-email-input"
                />
                <p className="text-xs text-muted-foreground">
                  Your administrator can also retrieve the token from the audit log.
                </p>
              </div>
              <Button
                type="submit"
                disabled={busy}
                className="w-full h-12 rounded-full bg-brand hover:bg-brand-secondary text-base font-semibold active:scale-[0.98] transition"
                data-testid="forgot-submit-button"
              >
                {busy ? "Working…" : "Generate Reset Token"}
              </Button>
            </form>
          ) : (
            <form onSubmit={reset} className="space-y-4">
              <div className="flex items-start gap-2.5 rounded-xl border border-success/40 bg-success/10 px-3 py-2.5" data-testid="forgot-sent-confirmation">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-success" />
                <p className="min-w-0 text-sm font-semibold text-success">
                  {requestedFor ? `Reset token created for ${requestedFor}.` : "Reset token ready."}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reset-token">Reset token</Label>
                <Input
                  id="reset-token"
                  required
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  className="h-12 rounded-xl font-mono-num"
                  data-testid="reset-token-input"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="Minimum 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="h-12 rounded-xl"
                  data-testid="reset-password-input"
                />
              </div>
              <Button
                type="submit"
                disabled={busy}
                className="w-full h-12 rounded-full bg-brand hover:bg-brand-secondary text-base font-semibold active:scale-[0.98] transition"
                data-testid="reset-submit-button"
              >
                {busy ? "Working…" : "Set New Password"}
              </Button>
            </form>
          )}

          <div className="mt-4 text-center">
            <Link to="/signin" className="inline-flex items-center gap-1 text-sm text-info hover:underline">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </Shell>
  );
}
