import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { errMsg } from "@/lib/api";

export default function SignIn() {
  const { user, login, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && user) {
    const home = (user.role === "athlete" || user.role === "parent") ? "/my-id" : "/dashboard";
    return <Navigate to={home} replace />;
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await login(email.trim(), password);
      // AuthProvider sets user; Navigate above / location replace via hard nav keeps SPA clean
      const home = (u?.role === "athlete" || u?.role === "parent") ? "/my-id" : "/dashboard";
      window.location.href = home;
    } catch (err) {
      toast.error(errMsg(err, "Sign in failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col hero-sweep">
      <div className="px-5 pt-5">
        <Link to="/" className="font-display text-xl text-foreground hover:text-brand transition-colors" data-testid="signin-back-home">
          60&apos;6&quot;
        </Link>
      </div>
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md relative z-10">
          <div className="flex flex-col items-center mb-8">
            <h1 className="font-display text-5xl text-foreground">Sign in</h1>
            <p className="text-sm text-muted-foreground mt-2 text-center">
              Access your dashboard, evaluations, or My ID.
            </p>
          </div>
          <Card className="rounded-2xl border-border bg-card">
            <CardContent className="pt-6 pb-6">
              <form onSubmit={submit} className="space-y-4">
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
                  className="w-full h-12 rounded-full bg-brand hover:bg-brand-secondary text-base font-semibold active:scale-[0.98] transition"
                  data-testid="sign-in-submit-button"
                >
                  {busy ? "Signing in…" : "Sign In"}
                </Button>
              </form>
              <div className="mt-4 text-center space-y-2">
                <Link to="/forgot-password" className="block text-sm text-info hover:underline" data-testid="forgot-password-link">
                  Forgot password?
                </Link>
                <Link to="/" className="block text-sm text-muted-foreground hover:text-foreground" data-testid="signin-home-link">
                  ← Back to home
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
