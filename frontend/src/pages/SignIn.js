import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import GoogleButton, { googleEnabled } from "@/components/common/GoogleButton";
import { toast } from "sonner";
import { errMsg } from "@/lib/api";

export default function SignIn() {
  const { user, login, googleAuth, loading } = useAuth();
  const navigate = useNavigate();
  // ?next=/register/<id> — internal-only redirect after sign-in (used by the
  // registration wizard's "sign in to add another athlete" path).
  const nextPath = (() => {
    const n = new URLSearchParams(window.location.search).get("next") || "";
    // "/" would bounce staff through the landing page's own redirect and skip
    // the mode picker — treat it as "no destination".
    return n.startsWith("/") && !n.startsWith("//") && n !== "/" ? n : null;
  })();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && user) {
    const home = nextPath || ((user.role === "athlete" || user.role === "parent") ? "/my-id" : "/workspace");
    return <Navigate to={home} replace />;
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await login(email.trim(), password);
      // AuthProvider sets user; staff land on the role-based mode picker.
      const home = nextPath || ((u?.role === "athlete" || u?.role === "parent") ? "/my-id" : "/workspace");
      window.location.href = home;
    } catch (err) {
      toast.error(errMsg(err, "Sign in failed."));
    } finally {
      setBusy(false);
    }
  };

  // Google: an existing account gets a token straight away; a brand-new email
  // is routed to /signup with the credential + profile prefilled.
  const onGoogleCredential = async (credential) => {
    try {
      const data = await googleAuth(credential);
      if (data?.needs_signup) {
        navigate("/signup", { state: { google: { credential, email: data.email, name: data.name } } });
        return;
      }
      const home = (data.user?.role === "athlete" || data.user?.role === "parent") ? "/my-id" : "/workspace";
      window.location.href = home;
    } catch (err) {
      toast.error(errMsg(err, "Google sign-in failed."));
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col hero-sweep">
      <div className="px-5 pt-5">
        <Link to="/" className="block hover:opacity-90 transition-opacity" data-testid="signin-back-home">
          <p className="font-display text-xl text-foreground">60&apos;6&quot; ID</p>
          <p className="text-[10px] uppercase tracking-[0.14em] text-brand">Train. Elevate. Succeed.</p>
        </Link>
      </div>
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md relative z-10">
          <div className="flex flex-col items-center mb-8">
            <h1 className="font-display text-5xl text-foreground">Sign in</h1>
            <p className="text-sm text-muted-foreground mt-2 text-center max-w-xs">
              Access your 60&apos;6&quot; ID dashboard, evaluations, or player profile.
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
              {googleEnabled && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-[hsl(var(--border))]" />
                    <span className="text-xs text-muted-foreground">or continue with Google</span>
                    <div className="h-px flex-1 bg-[hsl(var(--border))]" />
                  </div>
                  <GoogleButton onCredential={onGoogleCredential} />
                </div>
              )}
              <div className="mt-4 text-center space-y-2">
                <Link to="/signup" className="block text-sm text-info hover:underline" data-testid="signin-signup-link">
                  New here? Create your athlete&apos;s ID
                </Link>
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
