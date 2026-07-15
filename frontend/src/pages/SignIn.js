import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { errMsg } from "@/lib/api";

export default function SignIn() {
  const { user, login, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      toast.error(errMsg(err, "Sign in failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col hero-sweep grain-overlay">
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md relative z-10">
          <div className="flex flex-col items-center mb-8">
            <div className="h-16 w-16 rounded-2xl bg-[#0B1E3A] flex items-center justify-center ring-2 ring-[#F4B400]/60 mb-4">
              <ShieldCheck className="h-9 w-9 text-[#F4B400]" />
            </div>
            <h1 className="font-display text-5xl text-[#0B1E3A]">PBG SCOUT</h1>
            <p className="text-sm text-slate-600 mt-1">Identify. Evaluate. Develop. Connect.</p>
            <p className="text-xs text-slate-400 mt-1 uppercase tracking-widest">Philippines Baseball Group Midwest</p>
          </div>
          <Card className="rounded-2xl card-shadow border-[#E7E1D6]">
            <CardContent className="pt-6 pb-6">
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@pbgscout.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12 rounded-xl"
                    data-testid="sign-in-email-input"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    placeholder="Your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 rounded-xl"
                    data-testid="sign-in-password-input"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={busy}
                  className="w-full h-12 rounded-xl bg-[#0B1E3A] hover:bg-[#102A4F] text-base font-semibold active:scale-[0.98] transition"
                  data-testid="sign-in-submit-button"
                >
                  {busy ? "Signing in…" : "Sign In"}
                </Button>
              </form>
              <div className="mt-4 text-center">
                <Link to="/forgot-password" className="text-sm text-[#1F4AA8] hover:underline" data-testid="forgot-password-link">
                  Forgot password?
                </Link>
              </div>
            </CardContent>
          </Card>
          <p className="text-center text-xs text-slate-400 mt-6">
            Staff access only. Invitations are sent by your administrator.
          </p>
        </div>
      </div>
    </div>
  );
}
