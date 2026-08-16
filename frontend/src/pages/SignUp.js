import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import GoogleButton, { googleEnabled } from "@/components/common/GoogleButton";
import { toast } from "sonner";
import { errMsg } from "@/lib/api";
import { cn } from "@/lib/utils";

const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];

const KINDS = [
  { value: "parent", label: "I'm a parent/guardian" },
  { value: "athlete", label: "I'm the athlete (13 or older)" },
];

export default function SignUp() {
  const { user, loading, signup, googleAuth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Arriving from Google sign-in with no account: {credential, email, name}.
  const [google, setGoogle] = useState(location.state?.google || null);

  const [kind, setKind] = useState("parent");
  const [fullName, setFullName] = useState(google?.name || "");
  const [email, setEmail] = useState(google?.email || "");
  const [password, setPassword] = useState("");
  const [athlete, setAthlete] = useState({
    first_name: "", last_name: "", date_of_birth: "", graduation_year: "",
    primary_position: "", city: "", state: "",
  });
  const [joinCode, setJoinCode] = useState(() => new URLSearchParams(window.location.search).get("join") || "");
  const [busy, setBusy] = useState(false);

  if (!loading && user) {
    const home = (user.role === "athlete" || user.role === "parent") ? "/my-id" : "/dashboard";
    return <Navigate to={home} replace />;
  }

  const setA = (k) => (e) => setAthlete((a) => ({ ...a, [k]: e?.target ? e.target.value : e }));

  // Google button on the signup page itself: an existing account signs straight
  // in; otherwise the credential prefills this form (no password needed).
  const onGoogleCredential = async (credential) => {
    try {
      const data = await googleAuth(credential);
      if (data?.needs_signup) {
        setGoogle({ credential, email: data.email, name: data.name });
        setEmail(data.email || "");
        setFullName((f) => f || data.name || "");
        toast.success("Google account connected — finish signing up below.");
        return;
      }
      const home = (data.user?.role === "athlete" || data.user?.role === "parent") ? "/my-id" : "/dashboard";
      window.location.href = home;
    } catch (e) {
      toast.error(errMsg(e, "Google sign-in failed."));
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!google && password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        kind,
        full_name: fullName.trim(),
        email: email.trim(),
        ...(google ? { google_credential: google.credential } : { password }),
        athlete: {
          first_name: athlete.first_name.trim(),
          last_name: athlete.last_name.trim(),
          date_of_birth: athlete.date_of_birth || undefined,
          graduation_year: athlete.graduation_year ? parseInt(athlete.graduation_year) : undefined,
          primary_position: athlete.primary_position || undefined,
          city: athlete.city.trim() || undefined,
          state: athlete.state.trim() || undefined,
        },
        join_code: joinCode.trim() || undefined,
      };
      const data = await signup(payload);
      if (data.joined) {
        toast.success(`Joined ${data.joined.organization_name || "your club"} — pending coach approval`);
      }
      // Client-side navigate keeps the join toast visible; auth state is already set.
      navigate("/my-id", { replace: true });
    } catch (err) {
      toast.error(errMsg(err, "Sign up failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col hero-sweep" data-testid="signup-page">
      <div className="px-5 pt-5">
        <Link to="/" className="block hover:opacity-90 transition-opacity" data-testid="signup-back-home">
          <p className="font-display text-xl text-foreground">60&apos;6&quot; ID</p>
          <p className="text-[10px] uppercase tracking-[0.14em] text-brand">Train. Elevate. Succeed.</p>
        </Link>
      </div>
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md relative z-10">
          <div className="flex flex-col items-center mb-8">
            <h1 className="font-display text-5xl text-foreground">Create your ID</h1>
            <p className="text-sm text-muted-foreground mt-2 text-center max-w-xs">
              Start your athlete&apos;s permanent 60&apos;6&quot; ID — free for families.
            </p>
          </div>
          <Card className="rounded-2xl border-border bg-card">
            <CardContent className="pt-6 pb-6">
              <form onSubmit={submit} className="space-y-4">
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-border p-1" data-testid="signup-kind-toggle">
                  {KINDS.map((k) => (
                    <button
                      key={k.value}
                      type="button"
                      onClick={() => setKind(k.value)}
                      aria-pressed={kind === k.value}
                      data-testid={`signup-kind-${k.value}`}
                      className={cn(
                        "h-11 rounded-lg px-2 text-xs sm:text-sm font-semibold transition-colors",
                        kind === k.value ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="signup-full-name">Your full name</Label>
                  <Input
                    id="signup-full-name"
                    required
                    autoComplete="name"
                    placeholder={kind === "parent" ? "Parent/guardian name" : "Your name"}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="h-11 rounded-xl"
                    data-testid="signup-full-name-input"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={!!google}
                    className="h-11 rounded-xl"
                    data-testid="signup-email-input"
                  />
                  {google && <p className="text-xs text-muted-foreground">Signing up with your Google account — no password needed.</p>}
                </div>
                {!google && (
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-password">Password</Label>
                    <Input
                      id="signup-password"
                      type="password"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-11 rounded-xl"
                      data-testid="signup-password-input"
                    />
                  </div>
                )}

                <div className="pt-1">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {kind === "parent" ? "Your athlete" : "About you as a player"}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-athlete-first">First name</Label>
                    <Input id="signup-athlete-first" required value={athlete.first_name} onChange={setA("first_name")} className="h-11 rounded-xl" data-testid="signup-athlete-first-name-input" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-athlete-last">Last name</Label>
                    <Input id="signup-athlete-last" required value={athlete.last_name} onChange={setA("last_name")} className="h-11 rounded-xl" data-testid="signup-athlete-last-name-input" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-athlete-dob">Date of birth</Label>
                    <Input id="signup-athlete-dob" type="date" value={athlete.date_of_birth} onChange={setA("date_of_birth")} className="h-11 rounded-xl" data-testid="signup-athlete-dob-input" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-athlete-grad">Grad year</Label>
                    <Input id="signup-athlete-grad" type="number" placeholder="e.g. 2030" value={athlete.graduation_year} onChange={setA("graduation_year")} className="h-11 rounded-xl" data-testid="signup-athlete-grad-year-input" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Primary position</Label>
                    <Select value={athlete.primary_position || undefined} onValueChange={setA("primary_position")}>
                      <SelectTrigger className="h-11 rounded-xl" data-testid="signup-athlete-position-select"><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>{POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-athlete-city">City</Label>
                    <Input id="signup-athlete-city" value={athlete.city} onChange={setA("city")} className="h-11 rounded-xl" data-testid="signup-athlete-city-input" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="signup-athlete-state">State</Label>
                    <Input id="signup-athlete-state" value={athlete.state} onChange={setA("state")} className="h-11 rounded-xl" data-testid="signup-athlete-state-input" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="signup-join-code">Have a club join code? <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    id="signup-join-code"
                    placeholder="e.g. ABC-1234"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    className="h-11 rounded-xl font-mono"
                    data-testid="signup-join-code-input"
                  />
                  <p className="text-xs text-muted-foreground">With a code, your athlete lands in that club&apos;s pending list for coach approval.</p>
                </div>

                <Button
                  type="submit"
                  disabled={busy}
                  className="w-full h-12 rounded-full bg-brand hover:bg-brand-secondary text-base font-semibold active:scale-[0.98] transition"
                  data-testid="signup-submit-button"
                >
                  {busy ? "Creating account…" : "Create Account"}
                </Button>
              </form>

              {googleEnabled && !google && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-[hsl(var(--border))]" />
                    <span className="text-xs text-muted-foreground">or continue with Google</span>
                    <div className="h-px flex-1 bg-[hsl(var(--border))]" />
                  </div>
                  <GoogleButton onCredential={onGoogleCredential} text="signup_with" />
                </div>
              )}

              <div className="mt-4 text-center space-y-2">
                <Link to="/signin" className="block text-sm text-info hover:underline" data-testid="signup-signin-link">
                  Already have an account? Sign in
                </Link>
                <Link to="/" className="block text-sm text-muted-foreground hover:text-foreground" data-testid="signup-home-link">
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
