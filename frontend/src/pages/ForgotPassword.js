import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, KeyRound } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const request = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post("/auth/forgot-password", { email: email.trim() });
      setSent(true);
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
    <div className="min-h-screen bg-background flex items-center justify-center px-4 hero-sweep">
      <div className="w-full max-w-md">
        <Card className="rounded-2xl card-shadow border-[#E7E1D6]">
          <CardContent className="pt-6 pb-6">
            <div className="flex items-center gap-2 mb-4">
              <KeyRound className="h-5 w-5 text-[#0B1E3A]" />
              <h1 className="font-display text-3xl text-[#0B1E3A]">Reset Password</h1>
            </div>
            {!sent ? (
              <form onSubmit={request} className="space-y-4">
                <p className="text-sm text-slate-600">
                  Enter your email. A reset token will be generated — your administrator can also retrieve it from the audit log.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 rounded-xl" data-testid="forgot-email-input" />
                </div>
                <Button type="submit" disabled={busy} className="w-full h-12 rounded-xl bg-[#0B1E3A] hover:bg-[#102A4F]" data-testid="forgot-submit-button">
                  {busy ? "Working…" : "Generate Reset Token"}
                </Button>
              </form>
            ) : (
              <form onSubmit={reset} className="space-y-4">
                <p className="text-sm text-slate-600">Enter the reset token and choose a new password (min 8 characters).</p>
                <div className="space-y-1.5">
                  <Label>Reset token</Label>
                  <Input required value={resetToken} onChange={(e) => setResetToken(e.target.value)} className="h-12 rounded-xl font-mono-num" data-testid="reset-token-input" />
                </div>
                <div className="space-y-1.5">
                  <Label>New password</Label>
                  <Input type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="h-12 rounded-xl" data-testid="reset-password-input" />
                </div>
                <Button type="submit" disabled={busy} className="w-full h-12 rounded-xl bg-[#0B1E3A] hover:bg-[#102A4F]" data-testid="reset-submit-button">
                  {busy ? "Working…" : "Set New Password"}
                </Button>
              </form>
            )}
            <div className="mt-4">
              <Link to="/signin" className="inline-flex items-center gap-1 text-sm text-[#1F4AA8] hover:underline">
                <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
