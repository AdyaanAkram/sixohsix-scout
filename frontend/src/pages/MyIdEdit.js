import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export default function MyIdEdit() {
  const navigate = useNavigate();
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    api.get("/me/athlete").then((r) => setBio(r.data.bio || "")).catch((e) => toast.error(errMsg(e)));
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      await api.patch("/me/athlete", { bio });
      toast.success("Profile updated.");
      navigate("/my-id");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post("/me/athlete/photo", fd);
      toast.success(r.data.message || "Photo uploaded.");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setPhotoBusy(false);
      e.target.value = "";
    }
  };

  return (
    <div className="space-y-5 max-w-lg" data-testid="my-id-edit-page">
      <div>
        <Link to="/my-id" className="inline-flex items-center gap-1 text-sm text-info hover:underline mb-2">
          <ArrowLeft className="h-3.5 w-3.5" /> My ID
        </Link>
        <h1 className="font-display text-3xl text-foreground">Edit profile</h1>
        <p className="text-sm text-muted-foreground">Bio and photo only — metrics are coach-controlled.</p>
      </div>

      <Card className="rounded-2xl border-border bg-card">
        <CardContent className="pt-5 pb-5 space-y-4">
          <div className="space-y-1.5">
            <Label>Profile photo</Label>
            <input type="file" accept="image/*" onChange={onPhoto} disabled={photoBusy} data-testid="my-id-photo-input" className="block w-full text-sm text-muted-foreground" />
            <p className="text-[11px] text-muted-foreground">Max 5 MB. Under-18 uploads need guardian consent before coaches see them.</p>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <Label htmlFor="bio">Bio</Label>
              <span className="text-[11px] text-muted-foreground font-mono-num">{bio.length}/500</span>
            </div>
            <Textarea
              id="bio"
              value={bio}
              maxLength={500}
              onChange={(e) => setBio(e.target.value)}
              rows={5}
              className="rounded-xl bg-surface-3"
              placeholder="Tell your story…"
              data-testid="my-id-bio-textarea"
            />
          </div>
          <Button onClick={save} disabled={busy} className="w-full h-11 rounded-xl bg-primary hover:bg-brand-secondary" data-testid="my-id-save-button">
            {busy ? "Saving…" : "Save"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
