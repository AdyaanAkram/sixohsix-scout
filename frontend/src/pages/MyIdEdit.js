import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { resolvePhotoSrc } from "@/components/common/PlayerAvatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { ArrowLeft, Camera, Check, Info } from "lucide-react";

/*
  Exactly the five checks MyId (and the staff PlayerProfile) use. Copied rather
  than imported so this page can never drift from the portal's percentage — a
  parent who sees "60%" on My ID must see "60%" here. Change both or neither.
*/
function computeProfileCompletion(athlete, summary, mediaList) {
  const checks = [
    { key: "photo", label: "Updated photo", ok: Boolean(athlete?.photo_url) },
    { key: "height", label: "Current height", ok: Boolean(athlete?.height) },
    { key: "weight", label: "Current weight", ok: Boolean(athlete?.weight) },
    { key: "eval", label: "Recent evaluation", ok: (summary?.evaluation_count || 0) > 0 },
    {
      key: "video",
      label: "Approved video",
      ok: (mediaList || []).some(
        (m) =>
          (m.media_type || m.file_type || m.content_type || "").includes("video") &&
          (m.consent_status === "approved" || m.status === "approved" || m.consent_verified)
      ),
    },
  ];
  const done = checks.filter((c) => c.ok).length;
  return { pct: Math.round((done / checks.length) * 100), missing: checks.filter((c) => !c.ok).map((c) => c.label), checks };
}

/*
  Where each missing item actually comes from. Every one of the five is written
  by staff at a camp — PATCH /me/athlete accepts only `bio` — so the checklist
  explains rather than sending a parent hunting for a field that isn't here.
*/
const CHECK_SOURCE = {
  photo: "Added by your coach at camp",
  height: "Measured by your coach at camp",
  weight: "Measured by your coach at camp",
  eval: "Fills in after the next camp",
  video: "Uploaded by a coach, then approved by you",
};

/* Tiny uppercase panel header — the card anatomy every other page in the app uses. */
const PanelLabel = ({ children }) => (
  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>
);

/* Photo header, same idiom as the roster card and the portal hero: the real
   photo when the athlete has one, otherwise a branded monogram panel with a
   faded position watermark — a photo-less family should still see something
   that looks made for them. */
const CardPhoto = ({ p }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [p?.photo_url]);
  const src = !failed ? resolvePhotoSrc(p?.photo_url) : null;
  if (src) {
    return (
      <img
        src={src}
        alt={`${p?.first_name || ""} ${p?.last_name || ""}`.trim() || "Player"}
        className="h-full w-full object-cover object-top"
        onError={() => setFailed(true)}
      />
    );
  }
  const initials = `${(p?.first_name || "?")[0] || ""}${(p?.last_name || "")[0] || ""}`.toUpperCase();
  return (
    <div className="relative flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-tertiary via-secondary to-background">
      {p?.primary_position && (
        <span className="absolute -right-2 bottom-0 select-none font-display text-7xl font-extrabold leading-none text-foreground/[0.06]">
          {p.primary_position}
        </span>
      )}
      <span className="select-none font-display text-5xl text-brand/70">{initials}</span>
    </div>
  );
};

/* One labelled section of the form. Presentational only — never wrap an input
   in a component defined inside the page, or every keystroke remounts it. */
/* Module level: an inline component holding an <Input> is remounted on every
   keystroke, so the field loses focus after each character. */
const EditField = ({ label, value, onChange, placeholder, testId }) => (
  <div className="space-y-1.5 min-w-0">
    <Label className="text-xs text-muted-foreground">{label}</Label>
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-11 rounded-xl"
      data-testid={testId}
    />
  </div>
);

const Section = ({ label, hint, children, testId }) => (
  <Card className="rounded-2xl border-border bg-card" data-testid={testId}>
    <CardContent className="space-y-4 pt-5 pb-5">
      <div className="min-w-0">
        <PanelLabel>{label}</PanelLabel>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </CardContent>
  </Card>
);

export default function MyIdEdit() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  // Multi-child families: the portal can hand us the selected child. Absent the
  // param the backend falls back to the first linked athlete, exactly as before.
  const athleteId = searchParams.get("athlete_id");
  const [athlete, setAthlete] = useState(null);
  const [summary, setSummary] = useState(null);
  const [media, setMedia] = useState([]);
  const [bio, setBio] = useState("");
  // Savable by a family now that MeAthletePatch matches ATHLETE_PATCH_WHITELIST.
  const [form, setForm] = useState({ height: "", weight: "", primary_position: "",
    bats: "", throws: "", current_team: "", school: "", city: "", state: "" });
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    const params = athleteId ? { athlete_id: athleteId } : undefined;
    api.get("/me/athlete", { params })
      .then((r) => {
        setAthlete(r.data); setBio(r.data.bio || "");
        setForm({
          height: r.data.height || "", weight: r.data.weight || "",
          primary_position: r.data.primary_position || "",
          bats: r.data.bats || "", throws: r.data.throws || "",
          current_team: r.data.current_team || "", school: r.data.school || "",
          city: r.data.city || "", state: r.data.state || "",
        });
      })
      .catch((e) => toast.error(errMsg(e)));
    // The completion summary mirrors the portal, so it reads the portal's two
    // other sources. Both are optional: a failure must never block editing.
    api.get("/me/summary", { params }).then((r) => setSummary(r.data)).catch(() => setSummary(null));
    api.get("/me/media", { params })
      .then((r) => setMedia(Array.isArray(r.data) ? r.data : r.data?.media || []))
      .catch(() => setMedia([]));
  }, [athleteId]);

  const save = async () => {
    setBusy(true);
    try {
      // Send only what the family actually filled in; blanks stay untouched
      // rather than overwriting a value a coach recorded.
      const payload = { bio };
      Object.entries(form).forEach(([k, v]) => {
        const val = typeof v === "string" ? v.trim() : v;
        if (val) payload[k] = val;
      });
      await api.patch("/me/athlete", payload, athleteId ? { params: { athlete_id: athleteId } } : undefined);
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
      // Refresh so the preview and the completion bar reflect the new photo.
      const params = athleteId ? { athlete_id: athleteId } : undefined;
      api.get("/me/athlete", { params }).then((a) => setAthlete(a.data)).catch(() => {});
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setPhotoBusy(false);
      e.target.value = "";
    }
  };

  const firstName = athlete?.first_name || "your athlete";
  const completion = computeProfileCompletion(athlete, summary, media);
  // Photo uploads are org-only (POST /me/athlete/photo returns 403 for parent
  // and athlete accounts), so families get the explanation, not a dead button.
  const isFamily = user?.role === "parent" || user?.role === "athlete";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4" data-testid="my-id-edit-page">
      <div className="min-w-0">
        <Link to="/my-id" className="mb-2 inline-flex items-center gap-1 text-sm text-info hover:underline">
          <ArrowLeft className="h-3.5 w-3.5 shrink-0" /> My ID
        </Link>
        <h1 className="break-words font-display text-3xl leading-tight text-foreground">
          {athlete ? `${firstName}’s profile` : "Edit profile"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add your part of the story — coaches fill in the measured numbers at camp.
        </p>
      </div>

      {/* Live completion — the same five checks, and the same percentage, the
          portal shows. It updates as the underlying record does. */}
      {athlete && (
        <Card className="rounded-2xl border-border bg-card" data-testid="my-id-edit-completion">
          <CardContent className="space-y-3 pt-4 pb-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <PanelLabel>What&apos;s still missing</PanelLabel>
              <p className="font-mono-num text-2xl font-bold text-brand" data-testid="my-id-edit-completion-pct">
                {completion.pct}%
              </p>
            </div>
            <Progress value={completion.pct} className="h-3" />
            <p className="text-xs text-muted-foreground">
              {completion.missing.length === 0
                ? "Everything coaches look for is on file."
                : `A few things would round out ${firstName}’s profile:`}
            </p>
            <ul className="space-y-2">
              {completion.checks.map((c) => (
                <li
                  key={c.key}
                  className="flex items-start gap-2"
                  data-testid={`my-id-edit-check-${c.key}`}
                >
                  <span
                    className={`mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full ${
                      c.ok ? "bg-success/20 text-success" : "border border-warning/50 text-warning"
                    }`}
                  >
                    {c.ok && <Check className="h-3 w-3" />}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-xs ${c.ok ? "text-muted-foreground" : "font-semibold text-foreground"}`}>
                      {c.label}
                    </p>
                    {!c.ok && (
                      <p className="text-[11px] text-muted-foreground">{CHECK_SOURCE[c.key]}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ------------------------------ PHOTO ------------------------------ */}
      <Section
        label="Photo"
        hint={
          isFamily
            ? "This is the first thing a coach sees. Photos are taken and added by your club’s staff at camp."
            : "This is the first thing a coach sees. JPG, PNG, WEBP or HEIC, up to 5 MB."
        }
        testId="my-id-edit-photo-card"
      >
        <div className="flex flex-wrap items-center gap-4">
          <div
            className="h-28 w-28 shrink-0 overflow-hidden rounded-2xl ring-2 ring-brand/40"
            data-testid="my-id-edit-photo-preview"
          >
            <CardPhoto p={athlete} />
          </div>
          <div className="min-w-0 flex-1 basis-[200px] space-y-2">
            {isFamily ? (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
                <span className="min-w-0">
                  Ask your coach at the next camp and they&apos;ll add it — it shows up here and on
                  {" "}{firstName}&apos;s shared ID Story automatically.
                </span>
              </p>
            ) : (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Camera className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
                <span className="min-w-0">
                  Head and shoulders, facing the camera. Under-18 uploads need guardian consent
                  before coaches see them.
                </span>
              </p>
            )}
            <Label htmlFor="my-id-photo" className="sr-only">Profile photo</Label>
            <input
              id="my-id-photo"
              type="file"
              accept="image/*"
              onChange={onPhoto}
              disabled={photoBusy}
              data-testid="my-id-photo-input"
              className="block w-full min-w-0 cursor-pointer rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-foreground hover:border-brand/60 disabled:opacity-50"
            />
            {photoBusy && <p className="text-xs text-muted-foreground">Uploading…</p>}
          </div>
        </div>
      </Section>

      {/* ------------------------------- BIO ------------------------------- */}
      <Section
        label="Your story"
        hint="The part only your family can write — what drives them, what they’re working on, what a coach should know."
        testId="my-id-edit-bio-card"
      >
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="bio" className="text-sm">Bio</Label>
            <span className="font-mono-num text-[11px] text-muted-foreground">{bio.length}/500</span>
          </div>
          <Textarea
            id="bio"
            value={bio}
            maxLength={500}
            onChange={(e) => setBio(e.target.value)}
            rows={6}
            className="min-w-0 rounded-xl bg-surface-3"
            placeholder="Tell your story…"
            data-testid="my-id-bio-textarea"
          />
          <p className="text-[11px] text-muted-foreground">
            This appears on the public ID Story you share with family and coaches.
          </p>
        </div>
      </Section>

      {/* ----------------------- ABOUT THE ATHLETE ------------------------- */}
      <Section
        label="About the athlete"
        hint={`Anything you fill in here shows on ${firstName}'s ID. Timed numbers still come from a coach at camp.`}
        testId="my-id-edit-about"
      >
        <div className="grid grid-cols-2 gap-3">
          <EditField label="Height" placeholder="e.g. 5' 4&quot;" value={form.height}
            onChange={(v) => setForm((f) => ({ ...f, height: v }))} testId="my-id-edit-height" />
          <EditField label="Weight" placeholder="e.g. 120 lb" value={form.weight}
            onChange={(v) => setForm((f) => ({ ...f, weight: v }))} testId="my-id-edit-weight" />
          <EditField label="Primary position" placeholder="e.g. SS" value={form.primary_position}
            onChange={(v) => setForm((f) => ({ ...f, primary_position: v.toUpperCase() }))} testId="my-id-edit-position" />
          <EditField label="Team" placeholder="Club or school team" value={form.current_team}
            onChange={(v) => setForm((f) => ({ ...f, current_team: v }))} testId="my-id-edit-team" />
          <EditField label="Bats" placeholder="R, L or S" value={form.bats}
            onChange={(v) => setForm((f) => ({ ...f, bats: v.toUpperCase().slice(0, 1) }))} testId="my-id-edit-bats" />
          <EditField label="Throws" placeholder="R or L" value={form.throws}
            onChange={(v) => setForm((f) => ({ ...f, throws: v.toUpperCase().slice(0, 1) }))} testId="my-id-edit-throws" />
          <EditField label="School" placeholder="School name" value={form.school}
            onChange={(v) => setForm((f) => ({ ...f, school: v }))} testId="my-id-edit-school" />
          <EditField label="City" placeholder="City" value={form.city}
            onChange={(v) => setForm((f) => ({ ...f, city: v }))} testId="my-id-edit-city" />
        </div>
      </Section>

      <div className="flex flex-wrap gap-3">
        <Button
          onClick={save}
          disabled={busy}
          className="h-11 min-w-0 flex-1 basis-[160px] rounded-xl bg-primary hover:bg-brand-secondary"
          data-testid="my-id-save-button"
        >
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button
          asChild
          variant="outline"
          className="h-11 min-w-0 flex-1 basis-[120px] rounded-xl"
        >
          <Link to="/my-id">Cancel</Link>
        </Button>
      </div>
    </div>
  );
}
