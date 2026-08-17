import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errMsg, setToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";

export default function Redeem() {
  const [form, setForm] = useState({ code: (new URLSearchParams(window.location.search).get("code") || "").toUpperCase(), email: "", full_name: "", password: "" });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post("/events/redeem", form);
      setToken(r.data.token);
      localStorage.setItem("pbg_user", JSON.stringify(r.data.user));
      toast.success("Joined the event staff. Welcome!");
      // Force auth context refresh via full navigation
      window.location.href = r.data.event_id ? `/events/${r.data.event_id}` : "/dashboard";
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 hero-sweep">
      <Card className="w-full max-w-md rounded-2xl border-border" data-testid="redeem-page">
        <CardContent className="pt-6 pb-6 space-y-4">
          <div>
            <h1 className="font-display text-3xl text-foreground">Redeem invite code</h1>
            <p className="text-sm text-muted-foreground mt-1">Join an evaluation event as coach or evaluator.</p>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Invite code</Label>
              <Input required value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                className="h-11 rounded-xl font-mono-num tracking-widest" placeholder="ABC123" data-testid="redeem-code-input" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Full name</Label>
              <Input required value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                className="h-11 rounded-xl" data-testid="redeem-name-input" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Email</Label>
              <Input type="email" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="h-11 rounded-xl" data-testid="redeem-email-input" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Password (min 8)</Label>
              <Input type="password" required minLength={8} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="h-11 rounded-xl" data-testid="redeem-password-input" />
            </div>
            <Button type="submit" disabled={busy} className="w-full h-11 rounded-xl bg-primary" data-testid="redeem-submit">
              {busy ? "Joining…" : "Join event"}
            </Button>
          </form>
          <Link to="/signin" className="block text-center text-sm text-info hover:underline">Already have an account? Sign in</Link>
        </CardContent>
      </Card>
    </div>
  );
}
