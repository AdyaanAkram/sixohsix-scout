import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errMsg, setToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Ticket } from "lucide-react";

/* Top-level (stable identity) so the inputs keep focus across re-renders. */
const Shell = ({ children }) => (
  <div className="min-h-screen bg-background flex flex-col hero-sweep">
    <div className="px-5 pt-5">
      <Link to="/" className="block hover:opacity-90 transition-opacity" data-testid="redeem-back-home">
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

export default function Redeem() {
  const [form, setForm] = useState({ code: (new URLSearchParams(window.location.search).get("code") || "").toUpperCase(), email: "", full_name: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api.post("/events/redeem", form);
      setToken(r.data.token);
      localStorage.setItem("pbg_user", JSON.stringify(r.data.user));
      toast.success("Joined the event staff. Welcome!");
      setJoined(true);
      // Force auth context refresh via full navigation
      window.location.href = r.data.event_id ? `/events/${r.data.event_id}` : "/dashboard";
    } catch (err) {
      const msg = errMsg(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div className="flex flex-col items-center text-center mb-8">
        <div className="h-12 w-12 rounded-xl grid place-items-center bg-brand/15 text-brand mb-3">
          <Ticket className="h-6 w-6" />
        </div>
        <h1 className="font-display text-4xl sm:text-5xl text-foreground">Join an event</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-xs">
          Enter the access code from your coach to join an evaluation event as coach or evaluator.
        </p>
      </div>

      <Card className="rounded-2xl border-border bg-card" data-testid="redeem-page">
        <CardContent className="pt-6 pb-6 space-y-4">
          {joined ? (
            <div className="flex flex-col items-center text-center py-6" data-testid="redeem-success">
              <CheckCircle2 className="h-12 w-12 text-success" />
              <p className="font-display text-3xl text-foreground mt-3">You&apos;re in</p>
              <p className="text-sm text-muted-foreground mt-1">Opening your event…</p>
            </div>
          ) : (
            <>
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <PanelLabel>Access code</PanelLabel>
                  <Input
                    id="redeem-code"
                    aria-label="Access code"
                    required
                    value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                    className="h-16 rounded-xl font-mono-num text-center text-2xl font-bold uppercase tracking-[0.35em] placeholder:tracking-[0.35em] placeholder:font-normal placeholder:text-muted-foreground/60"
                    placeholder="ABC123"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    autoComplete="off"
                    data-testid="redeem-code-input"
                  />
                  <p className="text-xs text-muted-foreground text-center">Codes are not case sensitive.</p>
                </div>

                {error && (
                  <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5" data-testid="redeem-error">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
                    <p className="min-w-0 text-sm font-semibold text-destructive">{error}</p>
                  </div>
                )}

                <div className="rounded-xl border border-border bg-secondary/60 px-4 py-3.5 space-y-3">
                  <PanelLabel>Your details</PanelLabel>
                  <div className="space-y-1.5">
                    <Label htmlFor="redeem-name">Full name</Label>
                    <Input
                      id="redeem-name"
                      required
                      autoComplete="name"
                      value={form.full_name}
                      onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                      className="h-11 rounded-xl bg-card"
                      data-testid="redeem-name-input"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="redeem-email">Email</Label>
                    <Input
                      id="redeem-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      className="h-11 rounded-xl bg-card"
                      data-testid="redeem-email-input"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="redeem-password">Password</Label>
                    <Input
                      id="redeem-password"
                      type="password"
                      required
                      minLength={8}
                      autoComplete="new-password"
                      placeholder="Minimum 8 characters"
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      className="h-11 rounded-xl bg-card"
                      data-testid="redeem-password-input"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={busy}
                  className="w-full h-12 rounded-full bg-brand hover:bg-brand-secondary text-base font-semibold active:scale-[0.98] transition"
                  data-testid="redeem-submit"
                >
                  {busy ? "Joining…" : "Join event"}
                </Button>
              </form>

              <div className="text-center space-y-2">
                <Link to="/signin" className="block text-sm text-info hover:underline">Already have an account? Sign in</Link>
                <Link to="/" className="block text-sm text-muted-foreground hover:text-foreground">← Back to home</Link>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}
