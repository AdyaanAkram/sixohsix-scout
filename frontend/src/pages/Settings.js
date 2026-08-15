import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { api, API, errMsg, signedUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Building2, ShieldCheck, KeyRound, AlertTriangle, Upload, Trash2, Image as ImageIcon, Users, Copy, RefreshCw } from "lucide-react";

// Every text field the profile editor owns. PATCH sends only the changed subset,
// so an older backend that ignores the newer keys keeps working unchanged.
const PROFILE_FIELDS = [
  "name", "full_name", "tagline", "about",
  "contact_email", "contact_phone", "website_url",
  "city", "state", "country", "primary_color",
];

// Keys only the extended organization document carries (name/full_name/tagline/
// contact_email predate it, so they prove nothing). Backs up the route probe below,
// and a 404 on upload/remove still switches the photo controls back off.
const EXTENDED_KEYS = [
  "cover_url", "about", "primary_color",
  "city", "state", "country", "website_url", "contact_phone",
];

const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,.jpg,.jpeg,.png,.webp,.heic";

const formFromOrg = (o) =>
  PROFILE_FIELDS.reduce((acc, k) => ({ ...acc, [k]: o?.[k] == null ? "" : String(o[k]) }), {});

const looksLikeOrg = (d) => !!d && typeof d === "object" && !Array.isArray(d) && ("id" in d || "name" in d);

// Externally hosted URLs render directly; anything else is served by the
// authenticated /organization/{logo,cover} endpoints and needs a signed URL.
const imageSrc = (raw, path, version) => {
  if (!raw) return null;
  if (/^(https?:|data:)/i.test(raw)) return raw;
  return signedUrl(`${path}?v=${version}`);
};

export default function Settings() {
  const { user } = useAuth();
  const [org, setOrg] = useState(null);
  const [form, setForm] = useState(formFromOrg(null));
  const [baseline, setBaseline] = useState(formFromOrg(null));
  const [busy, setBusy] = useState(false);
  const [purging, setPurging] = useState(false);
  const [uploading, setUploading] = useState(null); // "logo" | "cover" | null
  const [photosSupported, setPhotosSupported] = useState(false);
  const [version, setVersion] = useState(() => Date.now());
  const [logoFailed, setLogoFailed] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const logoInput = useRef(null);
  const coverInput = useRef(null);
  const [joinCode, setJoinCode] = useState(null); // null → unavailable/hidden
  const [regenBusy, setRegenBusy] = useState(false);
  const isOwner = user?.role === "owner";
  const isAdmin = ["owner", "admin"].includes(user?.role);

  const adoptOrg = (doc) => {
    setOrg(doc);
    const next = formFromOrg(doc);
    setForm(next);
    setBaseline(next);
    if (EXTENDED_KEYS.some((k) => k in (doc || {}))) setPhotosSupported(true);
  };

  useEffect(() => {
    api.get("/organization")
      .then((r) => adoptOrg(r.data || {}))
      .catch((e) => { setOrg({}); toast.error(errMsg(e)); });
  }, []);

  // Family self-signup join code — admins only; a 404/403 simply hides the card.
  useEffect(() => {
    if (!isAdmin) return;
    api.get("/organization/join-code")
      .then((r) => setJoinCode(r.data?.join_code || null))
      .catch(() => setJoinCode(null));
  }, [isAdmin]);

  const copyJoinCode = async () => {
    try {
      await navigator.clipboard.writeText(joinCode);
      toast.success("Join code copied.");
    } catch {
      toast.error("Couldn't copy — select the code and copy it manually.");
    }
  };

  const regenerateJoinCode = async () => {
    if (!window.confirm("Regenerate the join code? The old code stops working immediately.")) return;
    setRegenBusy(true);
    try {
      const r = await api.post("/organization/join-code/regenerate");
      setJoinCode(r.data?.join_code || null);
      toast.success("New join code generated — the old one no longer works.");
    } catch (e) { toast.error(errMsg(e)); } finally { setRegenBusy(false); }
  };

  // Capability probe: a bare (unauthenticated) request answers 401 when the photo
  // routes exist and 404 when they don't. Raw axios so the app's 401 interceptor
  // never sees it — this must not sign anyone out.
  useEffect(() => {
    let alive = true;
    axios.get(`${API}/organization/cover`, { validateStatus: () => true })
      .then((r) => { if (alive && r.status !== 404) setPhotosSupported(true); })
      .catch(() => { /* offline or CORS — fall back to the org document shape */ });
    return () => { alive = false; };
  }, []);

  const logoSrc = imageSrc(org?.logo_url, "/organization/logo", version);
  const coverSrc = imageSrc(org?.cover_url, "/organization/cover", version);
  useEffect(() => { setLogoFailed(false); }, [logoSrc]);
  useEffect(() => { setCoverFailed(false); }, [coverSrc]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.name.trim()) { toast.error("Organization name is required."); return; }
    if (form.primary_color && !HEX.test(form.primary_color)) {
      toast.error("Primary color must be a hex value like #C8102E.");
      return;
    }
    const payload = {};
    PROFILE_FIELDS.forEach((k) => { if (form[k] !== baseline[k]) payload[k] = form[k]; });
    if (!Object.keys(payload).length) { toast("No changes to save."); return; }
    setBusy(true);
    try {
      await api.patch("/organization", payload);
      setBaseline(form);
      setOrg((o) => ({ ...(o || {}), ...payload }));
      toast.success("Organization updated.");
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };

  // Refresh previews straight from the mutation response; fall back to a GET if
  // the endpoint returned something other than the org document.
  const applyPhotoResult = async (data) => {
    if (looksLikeOrg(data)) setOrg(data);
    else {
      try { const r = await api.get("/organization"); if (looksLikeOrg(r.data)) setOrg(r.data); }
      catch { /* keep what we have rather than blanking the previews */ }
    }
    setVersion(Date.now());
  };

  const onPhotoError = (e) => {
    if (e?.response?.status === 404) {
      setPhotosSupported(false);
      toast.error("Organization photos aren’t available on this server yet.");
    } else toast.error(errMsg(e));
  };

  const upload = (kind) => async (e) => {
    const file = e.target.files?.[0];
    const input = e.target;
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error("Image must be 5 MB or smaller.");
      input.value = "";
      return;
    }
    setUploading(kind);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post(`/organization/${kind}`, fd);
      await applyPhotoResult(r.data);
      toast.success(kind === "logo" ? "Logo updated." : "Cover photo updated.");
    } catch (err) { onPhotoError(err); } finally { setUploading(null); input.value = ""; }
  };

  const removePhoto = (kind) => async () => {
    setUploading(kind);
    try {
      const r = await api.delete(`/organization/${kind}`);
      await applyPhotoResult(r.data);
      setOrg((o) => ({ ...(o || {}), [`${kind}_url`]: null }));
      toast.success(kind === "logo" ? "Logo removed." : "Cover photo removed.");
    } catch (err) { onPhotoError(err); } finally { setUploading(null); }
  };

  if (!org) return <Skeleton className="h-64 rounded-2xl" />;

  const showPhotos = photosSupported && isOwner;
  const showPhotoPreviews = showPhotos || (photosSupported && (logoSrc || coverSrc));
  const colorValid = HEX.test(form.primary_color);
  const field = (key, label, extra = {}) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        value={form[key]}
        onChange={set(key)}
        disabled={!isOwner}
        className="h-11 rounded-xl"
        {...extra}
      />
    </div>
  );

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="font-display text-4xl text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Organization and account settings.</p>
      </div>

      <Card className="rounded-2xl border-border" data-testid="org-profile-card">
        <CardContent className="pt-5 pb-5 space-y-5">
          <p className="font-semibold text-foreground flex items-center gap-2"><Building2 className="h-4 w-4" /> Organization Profile</p>

          {showPhotoPreviews && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">Cover photo</Label>
                <div className="w-full aspect-[8/3] rounded-xl overflow-hidden border border-border bg-surface-2 flex items-center justify-center">
                  {coverSrc && !coverFailed ? (
                    <img src={coverSrc} alt="" onError={() => setCoverFailed(true)} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-muted-foreground">
                      <ImageIcon className="h-6 w-6" />
                      <span className="text-xs">No cover photo</span>
                    </div>
                  )}
                </div>
                {showPhotos && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <input ref={coverInput} type="file" accept={ACCEPT} className="hidden" onChange={upload("cover")} />
                      <Button
                        variant="outline"
                        className="rounded-xl h-11"
                        disabled={!!uploading}
                        onClick={() => coverInput.current?.click()}
                        data-testid="org-cover-upload"
                      >
                        <Upload className="h-4 w-4 mr-1.5" />
                        {uploading === "cover" ? "Uploading…" : "Upload cover"}
                      </Button>
                      {org?.cover_url && (
                        <Button
                          variant="outline"
                          className="rounded-xl h-11 text-muted-foreground"
                          disabled={!!uploading}
                          onClick={removePhoto("cover")}
                          data-testid="org-cover-remove"
                        >
                          <Trash2 className="h-4 w-4 mr-1.5" /> Remove
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">Wide image works best (e.g. 1600×600). JPG, PNG, WEBP or HEIC up to 5 MB.</p>
                  </>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Logo</Label>
                <div className="flex items-center gap-4 flex-wrap">
                  {logoSrc && !logoFailed ? (
                    <img
                      src={logoSrc}
                      alt=""
                      onError={() => setLogoFailed(true)}
                      className="h-20 w-20 rounded-2xl object-cover ring-1 ring-border shrink-0"
                    />
                  ) : (
                    <div className="h-20 w-20 rounded-2xl bg-brand-tertiary ring-1 ring-brand/40 flex items-center justify-center shrink-0">
                      {form.name ? (
                        <span className="font-display text-2xl font-extrabold text-brand leading-none">{form.name.charAt(0).toUpperCase()}</span>
                      ) : (
                        <Building2 className="h-7 w-7 text-brand" />
                      )}
                    </div>
                  )}
                  {showPhotos && (
                    <div className="flex flex-wrap gap-2">
                      <input ref={logoInput} type="file" accept={ACCEPT} className="hidden" onChange={upload("logo")} />
                      <Button
                        variant="outline"
                        className="rounded-xl h-11"
                        disabled={!!uploading}
                        onClick={() => logoInput.current?.click()}
                        data-testid="org-logo-upload"
                      >
                        <Upload className="h-4 w-4 mr-1.5" />
                        {uploading === "logo" ? "Uploading…" : "Upload logo"}
                      </Button>
                      {org?.logo_url && (
                        <Button
                          variant="outline"
                          className="rounded-xl h-11 text-muted-foreground"
                          disabled={!!uploading}
                          onClick={removePhoto("logo")}
                          data-testid="org-logo-remove"
                        >
                          <Trash2 className="h-4 w-4 mr-1.5" /> Remove
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Identity</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Organization name</Label>
                <Input value={form.name} onChange={set("name")} disabled={!isOwner} className="h-11 rounded-xl" data-testid="org-name-input" />
              </div>
              {field("full_name", "Full name", { placeholder: "Legal or full program name" })}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tagline</Label>
              <Input value={form.tagline} onChange={set("tagline")} disabled={!isOwner} className="h-11 rounded-xl" data-testid="org-tagline-input" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">About</Label>
              <Textarea
                value={form.about}
                onChange={set("about")}
                disabled={!isOwner}
                rows={4}
                className="rounded-xl"
                data-testid="org-about-input"
              />
              <p className="text-xs text-muted-foreground">Shown on your organization pages.</p>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Contact</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {field("contact_email", "Contact email", { type: "email", placeholder: "info@example.com", "data-testid": "org-contact-email-input" })}
              {field("contact_phone", "Contact phone", { type: "tel", placeholder: "(555) 555-0100" })}
            </div>
            {field("website_url", "Website", { placeholder: "https://example.com" })}
          </div>

          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Location</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {field("city", "City")}
              {field("state", "State")}
              {field("country", "Country")}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Brand</p>
            <div className="space-y-1">
              <Label className="text-xs">Primary color</Label>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="color"
                  value={colorValid ? form.primary_color : "#000000"}
                  onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value.toUpperCase() }))}
                  disabled={!isOwner}
                  aria-label="Primary color picker"
                  data-testid="org-color-input"
                  className="h-11 w-14 shrink-0 rounded-xl border border-border bg-transparent p-1 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                />
                <Input
                  value={form.primary_color}
                  onChange={set("primary_color")}
                  disabled={!isOwner}
                  placeholder="#C8102E"
                  maxLength={7}
                  className="h-11 rounded-xl font-mono w-[140px]"
                  data-testid="org-color-hex-input"
                />
                <span
                  aria-hidden
                  className="h-9 w-9 shrink-0 rounded-full border border-border"
                  style={colorValid ? { backgroundColor: form.primary_color } : undefined}
                />
              </div>
              {form.primary_color && !colorValid && (
                <p className="text-xs text-destructive">Use a 6-digit hex value like #C8102E.</p>
              )}
            </div>
          </div>

          {isOwner && <Button onClick={save} disabled={busy} className="rounded-xl bg-primary hover:bg-brand-secondary h-11 w-full sm:w-auto" data-testid="org-save-button">{busy ? "Saving…" : "Save changes"}</Button>}
          {!isOwner && <p className="text-xs text-muted-foreground">Only the organization owner can edit these settings.</p>}
        </CardContent>
      </Card>

      {isAdmin && joinCode && (
        <Card className="rounded-2xl border-border" data-testid="org-join-code">
          <CardContent className="pt-5 pb-5 space-y-3">
            <p className="font-semibold text-foreground flex items-center gap-2"><Users className="h-4 w-4" /> Family signup & join code</p>
            <p className="text-sm text-muted-foreground">
              Share this code with families so their self-signup lands in your Pending list for approval.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-2xl font-bold tracking-[0.2em] text-brand rounded-xl border border-border bg-secondary px-4 py-2" data-testid="org-join-code-value">
                {joinCode}
              </span>
              <Button variant="outline" className="rounded-xl h-11" onClick={copyJoinCode} data-testid="org-join-code-copy">
                <Copy className="h-4 w-4 mr-1.5" /> Copy
              </Button>
              <Button
                variant="outline"
                className="rounded-xl h-11 text-muted-foreground"
                disabled={regenBusy}
                onClick={regenerateJoinCode}
                data-testid="org-join-code-regenerate"
              >
                <RefreshCw className="h-4 w-4 mr-1.5" /> {regenBusy ? "Regenerating…" : "Regenerate"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl border-border">
        <CardContent className="pt-5 pb-5 space-y-2">
          <p className="font-semibold text-foreground flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Privacy & Feature Flags</p>
          <div className="space-y-1.5 text-sm text-muted-foreground">
            <p>• Player profiles are private and staff-only by default.</p>
            <p>• Media uploads require verified consent (minor athlete protection).</p>
            <p>• Rankings and reports are internal only — never public.</p>
            <p>• Coach AI training plans: <span className="font-semibold text-muted-foreground">Coming Soon</span> — drafts require human coach approval before athletes see them</p>
            <p>• Athlete portal: <span className="font-semibold text-muted-foreground">Coming Soon</span></p>
            <p>• Parent portal: <span className="font-semibold text-muted-foreground">Coming Soon</span></p>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border">
        <CardContent className="pt-5 pb-5 space-y-2">
          <p className="font-semibold text-foreground flex items-center gap-2"><KeyRound className="h-4 w-4" /> Account</p>
          <p className="text-sm text-muted-foreground">Signed in as <span className="font-semibold">{user?.full_name}</span> ({user?.email})</p>
          <p className="text-xs text-muted-foreground">To change your password, use “Forgot password” on the sign-in page. Sessions expire automatically after 7 days.</p>
        </CardContent>
      </Card>

      {isOwner && (
        <Card className="rounded-2xl border-destructive/40" data-testid="danger-zone">
          <CardContent className="pt-5 pb-5 space-y-3">
            <p className="font-semibold text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Danger Zone
            </p>
            <div className="space-y-1.5 text-sm text-muted-foreground">
              <p><span className="font-semibold text-foreground">Remove all athletes</span> from{" "}
                <span className="font-semibold text-foreground">{org?.name || "this organization"}</span>{" "}
                — deletes every athlete plus their evaluations, measurements, media, notes, goals,
                seasons and event roster spots.</p>
              <p>Staff accounts, events, stations and templates are kept. Other organizations are
                never affected.{" "}
                <span className="text-destructive font-semibold">This cannot be undone.</span></p>
            </div>
            <Button
              variant="outline"
              className="rounded-xl border-destructive/50 text-destructive hover:bg-destructive/10"
              disabled={purging}
              data-testid="purge-athletes-button"
              onClick={async () => {
                const typed = window.prompt(
                  `This permanently deletes EVERY athlete in ${org?.name || "this organization"} and all their evaluation history.\n\nType DELETE ALL ATHLETES to confirm:`);
                if (typed !== "DELETE ALL ATHLETES") {
                  if (typed !== null) toast.error("Confirmation text did not match — nothing was deleted.");
                  return;
                }
                setPurging(true);
                try {
                  const r = await api.post("/athletes/purge-all", null,
                    { params: { confirm: "DELETE ALL ATHLETES" } });
                  const n = r.data?.removed?.athletes ?? 0;
                  toast.success(`Removed ${n} athlete${n === 1 ? "" : "s"} and their records.`);
                } catch (e) {
                  toast.error(errMsg(e));
                } finally {
                  setPurging(false);
                }
              }}
            >
              {purging ? "Removing…" : "Remove all athletes"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
