import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg, setToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import GoogleButton, { googleEnabled } from "@/components/common/GoogleButton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CalendarDays, CheckCircle2, MapPin, Shield, UserRound } from "lucide-react";

const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "UTIL"];
const RELATIONSHIPS = ["Mother", "Father", "Guardian", "Grandparent", "Other"];
const GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

const STEP_DEFS = [
  { id: 1, key: "parent", label: "Parent / Guardian" },
  { id: 2, key: "athlete", label: "Athlete" },
  { id: 3, key: "profile", label: "Baseball Profile" },
  { id: 4, key: "event", label: "This Event" },
  { id: 5, key: "emergency", label: "Emergency & Participation" },
  { id: 6, key: "waivers", label: "Waivers & Permissions" },
  { id: 7, key: "review", label: "Review & Sign" },
];

const EMPTY_ATHLETE = {
  first_name: "", last_name: "", middle_name: "", date_of_birth: "", graduation_year: "",
  current_grade: "", email: "", phone: "", gender: "", primary_position: "",
  secondary_positions: [], bats: "", throws: "", current_team: "", school: "",
  city: "", state: "", years_playing: "",
};

const EMAIL_RE = /\S+@\S+\.\S+/;

/* Display-only age from the DOB the parent is typing — never sent to the API. */
const calcAge = (dob) => {
  if (!dob) return null;
  const d = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a -= 1;
  return a >= 0 && a < 100 ? a : null;
};

/* Suggested grade from grad year: school years end mid-summer, so July+ rolls
   into the next ending year. 12 - (gradYear - endingYear), clamped to K-12. */
const suggestGrade = (gradYear) => {
  const gy = parseInt(gradYear, 10);
  if (!gy || gy < 2000 || gy > 2100) return "";
  const now = new Date();
  const endingYear = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
  const grade = 12 - (gy - endingYear);
  if (grade < 0 || grade > 12) return "";
  return grade === 0 ? "K" : String(grade);
};

/* Google Identity credential is a JWT — decode the payload client-side for
   email/name prefill only. The raw credential goes to the backend untouched. */
const decodeGoogleCredential = (credential) => {
  try {
    const payload = JSON.parse(atob(credential.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return { email: payload.email || "", given_name: payload.given_name || "", family_name: payload.family_name || "" };
  } catch {
    return { email: "", given_name: "", family_name: "" };
  }
};

const Chip = ({ active, onClick, disabled, children, testid }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-pressed={active}
    data-testid={testid}
    className={cn(
      "h-9 rounded-full border px-3.5 text-sm font-semibold transition-colors",
      active ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:text-foreground",
      disabled && "opacity-40 cursor-not-allowed"
    )}
  >
    {children}
  </button>
);

const Field = ({ label, required, children, hint }) => (
  <div className="space-y-1.5">
    <Label>{label}{required ? "" : <span className="text-muted-foreground font-normal"> (optional)</span>}</Label>
    {children}
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

/* Top-level (stable identity) so the wizard's inputs keep focus across re-renders. */
const Shell = ({ children }) => (
  <div className="min-h-screen bg-background flex flex-col hero-sweep" data-testid="register-event-page">
    <div className="px-5 pt-5">
      <Link to="/" className="block hover:opacity-90 transition-opacity" data-testid="register-back-home">
        <p className="font-display text-xl text-foreground">60&apos;6&quot; ID</p>
        <p className="text-[10px] uppercase tracking-[0.14em] text-brand">Train. Elevate. Succeed.</p>
      </Link>
    </div>
    <div className="flex-1 flex justify-center px-4 py-8">
      <div className="w-full max-w-xl relative z-10 space-y-4">{children}</div>
    </div>
  </div>
);

const ConsentCheck = ({ id, checked, onChange, children, testid }) => (
  <div className="flex items-start gap-2.5">
    <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(!!v)} className="mt-0.5" data-testid={testid} />
    <Label htmlFor={id} className="font-normal text-sm leading-snug">{children}</Label>
  </div>
);

export default function RegisterEvent() {
  const { eventId } = useParams();
  const { user, loading: authLoading } = useAuth();
  const signedIn = !!user && (user.role === "parent" || user.role === "athlete");

  const [info, setInfo] = useState(null);            // registration-info payload
  const [consentInfo, setConsentInfo] = useState(null); // consent-versions payload
  const [loadError, setLoadError] = useState(null);
  const [myAthletes, setMyAthletes] = useState([]);

  const [stepIdx, setStepIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);            // POST response on success
  const [showEventDetails, setShowEventDetails] = useState(false);
  const gradeTouched = useRef(false);

  const [google, setGoogle] = useState(null);        // stashed {credential}
  const [parent, setParent] = useState({
    first_name: "", last_name: "", relationship: "", email: "", phone: "",
    preferred_communication: "email", password: "",
  });
  const [athleteId, setAthleteId] = useState(null);  // reusing an existing athlete
  const [athlete, setAthlete] = useState(EMPTY_ATHLETE);
  const [positionsEvaluated, setPositionsEvaluated] = useState([]);
  const [emergency, setEmergency] = useState({ name: "", relationship: "", phone: "" });
  const [sameAsParent, setSameAsParent] = useState(false);
  const [hasParticipationInfo, setHasParticipationInfo] = useState(""); // "yes" | "no"
  const [participationNotes, setParticipationNotes] = useState("");
  const [consents, setConsents] = useState({
    participation_waiver: false,
    emergency_authorization: false,
    evaluation_media: "",   // "consent" | "decline"
    promotional_media: "",  // "yes" | "no"
    privacy_policy: false,
    terms: false,
    public_profile: false,  // default OFF for minors
  });
  const [signature, setSignature] = useState("");

  useEffect(() => {
    Promise.all([
      api.get(`/public/events/${eventId}/registration-info`),
      // Non-fatal: the waiver box falls back to a generic notice if this 404s.
      api.get("/public/consent-versions").catch(() => ({ data: null })),
    ])
      .then(([i, c]) => {
        setInfo(i.data);
        setConsentInfo(c.data);
      })
      .catch((e) => setLoadError(errMsg(e, "Could not load this event.")));
  }, [eventId]);

  useEffect(() => {
    if (!signedIn) return;
    api.get("/me/athletes", { params: { event_id: eventId } })
      .then((r) => setMyAthletes(Array.isArray(r.data) ? r.data : []))
      .catch(() => setMyAthletes([])); // endpoint may not be deployed yet
  }, [signedIn, eventId]);

  const steps = useMemo(
    () => (signedIn ? STEP_DEFS.filter((s) => s.key !== "parent") : STEP_DEFS),
    [signedIn]
  );
  const step = steps[Math.min(stepIdx, steps.length - 1)];

  const selectedAthlete = athleteId ? myAthletes.find((a) => a.id === athleteId) : null;

  const evalPositionOptions = useMemo(() => {
    const fromApi = (info?.positions || [])
      .map((p) => (typeof p === "string" ? p : p?.name || p?.position))
      .filter(Boolean);
    return fromApi.length ? fromApi : POSITIONS;
  }, [info]);

  const setP = (k) => (e) => setParent((p) => ({ ...p, [k]: e?.target ? e.target.value : e }));
  const setA = (k) => (e) => setAthlete((a) => ({ ...a, [k]: e?.target ? e.target.value : e }));

  const onGradYear = (e) => {
    const v = e.target.value;
    setAthlete((a) => ({
      ...a,
      graduation_year: v,
      ...(gradeTouched.current ? {} : { current_grade: suggestGrade(v) }),
    }));
  };

  const toggleSecondary = (pos) => {
    setAthlete((a) => {
      const has = a.secondary_positions.includes(pos);
      if (!has && a.secondary_positions.length >= 2) return a; // cap 2
      return {
        ...a,
        secondary_positions: has
          ? a.secondary_positions.filter((p) => p !== pos)
          : [...a.secondary_positions, pos],
      };
    });
  };

  const toggleEvalPosition = (pos) => {
    setPositionsEvaluated((ps) => {
      if (ps.includes(pos)) return ps.filter((p) => p !== pos);
      // 13-18 Performance track: evaluated at 1-2 positions max.
      const age = calcAge((selectedAthlete || athlete).date_of_birth);
      if (age != null && age >= 13 && ps.length >= 2) {
        toast.error("Athletes 13 and older are evaluated at up to 2 positions — unselect one first.");
        return ps;
      }
      return [...ps, pos];
    });
  };

  const onGoogleCredential = (credential) => {
    // Stash the credential for the registration POST — no sign-in round trip here.
    const claims = decodeGoogleCredential(credential);
    setGoogle({ credential });
    setParent((p) => ({
      ...p,
      email: claims.email || p.email,
      first_name: p.first_name || claims.given_name,
      last_name: p.last_name || claims.family_name,
      password: "",
    }));
    toast.success("Google account connected — no password needed.");
  };

  const onSameAsParent = (checked) => {
    setSameAsParent(!!checked);
    if (checked) {
      const name = signedIn
        ? (user?.full_name || "")
        : `${parent.first_name} ${parent.last_name}`.trim();
      setEmergency({
        name,
        relationship: signedIn ? "Guardian" : (parent.relationship || "Guardian"),
        phone: parent.phone || "",
      });
    }
  };

  const stepValid = (key) => {
    switch (key) {
      case "parent":
        return (
          parent.first_name.trim() && parent.last_name.trim() && parent.relationship &&
          EMAIL_RE.test(parent.email.trim()) && parent.phone.trim() &&
          parent.preferred_communication && (google || parent.password.length >= 8)
        );
      case "athlete":
        if (selectedAthlete) return true;
        return (
          athlete.first_name.trim() && athlete.last_name.trim() &&
          athlete.date_of_birth && athlete.graduation_year
        );
      case "profile":
        if (selectedAthlete) return true;
        return athlete.primary_position && athlete.bats && athlete.throws;
      case "event":
        return positionsEvaluated.length > 0;
      case "emergency":
        return (
          emergency.name.trim() && emergency.relationship.trim() && emergency.phone.trim() &&
          (hasParticipationInfo === "no" || (hasParticipationInfo === "yes" && participationNotes.trim()))
        );
      case "waivers":
        return (
          consents.participation_waiver && consents.emergency_authorization &&
          consents.evaluation_media && consents.promotional_media &&
          consents.privacy_policy && consents.terms
        );
      case "review":
        return signature.trim().length > 0;
      default:
        return false;
    }
  };

  const goNext = () => {
    const next = steps[stepIdx + 1];
    // Entering "This event" with nothing picked: default from primary + secondary.
    if (next?.key === "event" && positionsEvaluated.length === 0) {
      const src = selectedAthlete || athlete;
      const seed = [src.primary_position, ...(src.secondary_positions || [])]
        .filter((p) => p && evalPositionOptions.includes(p));
      if (seed.length) setPositionsEvaluated([...new Set(seed)]);
    }
    setStepIdx((i) => Math.min(i + 1, steps.length - 1));
    window.scrollTo({ top: 0 });
  };
  const goBack = () => {
    setStepIdx((i) => Math.max(i - 1, 0));
    window.scrollTo({ top: 0 });
  };

  const submit = async () => {
    setBusy(true);
    try {
      const num = (v) => (v === "" || v == null ? undefined : parseInt(v, 10));
      const opt = (v) => (v && String(v).trim() ? String(v).trim() : undefined);
      const payload = {
        ...(signedIn
          ? {}
          : {
              parent: {
                first_name: parent.first_name.trim(),
                last_name: parent.last_name.trim(),
                relationship: parent.relationship,
                email: parent.email.trim(),
                phone: parent.phone.trim(),
                preferred_communication: parent.preferred_communication,
                ...(google ? { google_credential: google.credential } : { password: parent.password }),
              },
            }),
        ...(selectedAthlete
          ? { athlete_id: selectedAthlete.id }
          : {
              athlete: {
                first_name: athlete.first_name.trim(),
                last_name: athlete.last_name.trim(),
                middle_name: opt(athlete.middle_name),
                date_of_birth: athlete.date_of_birth,
                graduation_year: num(athlete.graduation_year),
                current_grade: opt(athlete.current_grade),
                email: opt(athlete.email),
                phone: opt(athlete.phone),
                gender: opt(athlete.gender),
                primary_position: athlete.primary_position,
                secondary_positions: athlete.secondary_positions,
                bats: athlete.bats,
                throws: athlete.throws,
                current_team: opt(athlete.current_team),
                school: opt(athlete.school),
                city: opt(athlete.city),
                state: opt(athlete.state),
                years_playing: num(athlete.years_playing),
              },
            }),
        positions_evaluated: positionsEvaluated,
        emergency_contact: {
          name: emergency.name.trim(),
          relationship: emergency.relationship.trim(),
          phone: emergency.phone.trim(),
        },
        participation_notes: hasParticipationInfo === "yes" ? participationNotes.trim() || null : null,
        consents: {
          participation_waiver: consents.participation_waiver,
          emergency_authorization: consents.emergency_authorization,
          evaluation_media: consents.evaluation_media === "consent",
          promotional_media: consents.promotional_media === "yes",
          privacy_policy: consents.privacy_policy,
          terms: consents.terms,
          public_profile: consents.public_profile,
        },
        signature: { full_legal_name: signature.trim() },
      };
      const r = await api.post(`/public/events/${eventId}/register`, payload);
      // New-account registrations return a token — store it exactly like signup
      // does so /my-id and "register another" work without re-authenticating.
      if (r.data?.token) setToken(r.data.token);
      setDone(r.data);
      window.scrollTo({ top: 0 });
    } catch (e) {
      if (e?.response?.status === 409) {
        toast.error(errMsg(e, "An account with this email already exists — sign in first, then register."));
      } else {
        toast.error(errMsg(e, "Registration failed."));
      }
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <Shell>
        <Card className="rounded-2xl border-border bg-card">
          <CardContent className="py-8 text-center space-y-2">
            <p className="font-display text-3xl text-foreground">Event not found</p>
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <Button asChild variant="outline" className="rounded-xl mt-2"><Link to="/">Back to home</Link></Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (!info || authLoading) {
    return (
      <Shell>
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </Shell>
    );
  }

  const { event, organization } = info;

  const eventHeader = (
    <Card className="rounded-2xl border-border bg-card overflow-hidden">
      <CardContent className="py-4 flex items-center gap-4">
        {organization?.logo_url ? (
          <img src={organization.logo_url} alt={organization?.name || "Organization"} className="h-12 w-12 rounded-xl object-contain bg-white border border-border p-0.5 shrink-0" />
        ) : (
          <div className="h-12 w-12 rounded-xl bg-brand-tertiary/50 flex items-center justify-center shrink-0"><Shield className="h-6 w-6 text-brand" /></div>
        )}
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-brand font-semibold truncate">{organization?.name}</p>
          <p className="font-display text-2xl text-foreground truncate">{event?.name}</p>
          <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
            {event?.date && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /><span className="font-mono-num">{event.date}</span></span>}
            {event?.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{event.location}</span>}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">Event details filled in automatically.</p>
        </div>
      </CardContent>
    </Card>
  );

  if (!info.registration_open) {
    return (
      <Shell>
        {eventHeader}
        <Card className="rounded-2xl border-border bg-card" data-testid="register-closed">
          <CardContent className="py-8 text-center space-y-2">
            <p className="font-display text-3xl text-foreground">Registration is closed</p>
            <p className="text-sm text-muted-foreground">
              Online registration for this event isn&apos;t open right now. Reach out to {organization?.name || "the organization"} with any questions.
            </p>
            <Button asChild variant="outline" className="rounded-xl mt-2"><Link to="/">Back to home</Link></Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  /* ---------- success screen ---------- */

  if (done) {
    const athleteName = selectedAthlete
      ? `${selectedAthlete.first_name} ${selectedAthlete.last_name}`
      : `${athlete.first_name} ${athlete.last_name}`;
    return (
      <Shell>
        {eventHeader}
        <Card className="rounded-2xl border-border bg-card" data-testid="register-success">
          <CardContent className="py-8 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-success mx-auto" />
            <div>
              <p className="font-display text-3xl text-foreground">{athleteName} is registered</p>
              <p className="text-sm text-muted-foreground mt-1">Their permanent 60&apos;6&quot; ID is created.</p>
            </div>
            <div className="flex flex-col gap-2 max-w-xs mx-auto">
              <Button
                className="h-12 rounded-full bg-brand hover:bg-brand-secondary font-semibold"
                onClick={() => { window.location.href = "/my-id"; }}
                data-testid="register-success-view-id"
              >
                View Athlete ID
              </Button>
              <Button
                variant="outline"
                className="h-11 rounded-full"
                onClick={() => setShowEventDetails((s) => !s)}
                data-testid="register-success-event-details"
              >
                Event Details
              </Button>
              <Button
                variant="outline"
                className="h-11 rounded-full"
                onClick={() => window.location.reload()}
                data-testid="register-success-another"
              >
                Register Another Athlete
              </Button>
            </div>
            {showEventDetails && (
              <div className="rounded-xl border border-border bg-card px-4 py-3 text-left text-sm space-y-1">
                <p className="font-semibold">{event?.name}</p>
                {event?.event_type && <p className="text-muted-foreground capitalize">{String(event.event_type).replace(/_/g, " ")}</p>}
                {event?.date && <p className="text-muted-foreground font-mono-num">{event.date}</p>}
                {event?.location && <p className="text-muted-foreground">{event.location}</p>}
                {(done.positions_evaluated || positionsEvaluated).length > 0 && (
                  <p className="text-muted-foreground">Evaluating: {(done.positions_evaluated || positionsEvaluated).join(", ")}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </Shell>
    );
  }

  /* ---------- step bodies ---------- */

  const parentStep = (
    <div className="space-y-4">
      <div className="rounded-xl border border-info/40 bg-info/10 px-3.5 py-2.5 text-sm">
        Registered a child before, or already have a 60&apos;6&quot; account?{" "}
        <Link to={`/signin?next=/register/${eventId}`} className="font-semibold text-info underline" data-testid="register-signin-link">
          Sign in
        </Link>{" "}
        — then add another athlete without retyping your info.
      </div>
      {googleEnabled && !google && (
        <div className="space-y-3">
          <GoogleButton onCredential={onGoogleCredential} text="continue_with" />
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[hsl(var(--border))]" />
            <span className="text-xs text-muted-foreground">or with email</span>
            <div className="h-px flex-1 bg-[hsl(var(--border))]" />
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" required>
          <Input required autoComplete="given-name" value={parent.first_name} onChange={setP("first_name")} className="h-11 rounded-xl" data-testid="register-parent-first-name-input" />
        </Field>
        <Field label="Last name" required>
          <Input required autoComplete="family-name" value={parent.last_name} onChange={setP("last_name")} className="h-11 rounded-xl" data-testid="register-parent-last-name-input" />
        </Field>
      </div>
      <Field label="Relationship to athlete" required>
        <Select value={parent.relationship || undefined} onValueChange={setP("relationship")}>
          <SelectTrigger className="h-11 rounded-xl" data-testid="register-parent-relationship-select"><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent>{RELATIONSHIPS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Email" required hint={google ? "Registering with your Google account — no password needed." : undefined}>
        <Input type="email" required autoComplete="email" placeholder="you@example.com" value={parent.email} onChange={setP("email")} disabled={!!google} className="h-11 rounded-xl" data-testid="register-parent-email-input" />
      </Field>
      {!google && (
        <Field label="Password" required hint="At least 8 characters — this creates your parent account.">
          <Input type="password" required minLength={8} autoComplete="new-password" value={parent.password} onChange={setP("password")} className="h-11 rounded-xl" data-testid="register-parent-password-input" />
        </Field>
      )}
      <Field label="Mobile phone" required>
        <Input type="tel" required autoComplete="tel" placeholder="(555) 555-5555" value={parent.phone} onChange={setP("phone")} className="h-11 rounded-xl" data-testid="register-parent-phone-input" />
      </Field>
      <Field label="Preferred communication" required>
        <Select value={parent.preferred_communication} onValueChange={setP("preferred_communication")}>
          <SelectTrigger className="h-11 rounded-xl" data-testid="register-parent-communication-select"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="sms">SMS</SelectItem>
            <SelectItem value="both">Both</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </div>
  );

  const newAthleteForm = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" required>
          <Input required value={athlete.first_name} onChange={setA("first_name")} className="h-11 rounded-xl" data-testid="register-athlete-first-name-input" />
        </Field>
        <Field label="Last name" required>
          <Input required value={athlete.last_name} onChange={setA("last_name")} className="h-11 rounded-xl" data-testid="register-athlete-last-name-input" />
        </Field>
      </div>
      <Field label="Middle name">
        <Input value={athlete.middle_name} onChange={setA("middle_name")} className="h-11 rounded-xl" data-testid="register-athlete-middle-name-input" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date of birth" required hint={calcAge(athlete.date_of_birth) != null ? `Age: ${calcAge(athlete.date_of_birth)}` : undefined}>
          <Input type="date" required value={athlete.date_of_birth} onChange={setA("date_of_birth")} className="h-11 rounded-xl" data-testid="register-athlete-dob-input" />
        </Field>
        <Field label="Graduation year" required>
          <Input type="number" required placeholder="e.g. 2033" value={athlete.graduation_year} onChange={onGradYear} className="h-11 rounded-xl" data-testid="register-athlete-grad-year-input" />
        </Field>
      </div>
      <Field label="Current grade" hint="Suggested from graduation year — adjust if needed.">
        <Select
          value={athlete.current_grade || undefined}
          onValueChange={(v) => { gradeTouched.current = true; setAthlete((a) => ({ ...a, current_grade: v })); }}
        >
          <SelectTrigger className="h-11 rounded-xl" data-testid="register-athlete-grade-select"><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent>{GRADES.map((g) => <SelectItem key={g} value={g}>{g === "K" ? "Kindergarten" : `Grade ${g}`}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Athlete email">
          <Input type="email" value={athlete.email} onChange={setA("email")} className="h-11 rounded-xl" data-testid="register-athlete-email-input" />
        </Field>
        <Field label="Athlete mobile">
          <Input type="tel" value={athlete.phone} onChange={setA("phone")} className="h-11 rounded-xl" data-testid="register-athlete-phone-input" />
        </Field>
      </div>
      <Field label="Gender">
        <Select value={athlete.gender || undefined} onValueChange={setA("gender")}>
          <SelectTrigger className="h-11 rounded-xl" data-testid="register-athlete-gender-select"><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Male">Male</SelectItem>
            <SelectItem value="Female">Female</SelectItem>
            <SelectItem value="Prefer not to say">Prefer not to say</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </div>
  );

  const athleteStep = (
    <div className="space-y-4">
      {signedIn && myAthletes.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Select your athlete</p>
          {myAthletes.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={a.on_event}
              onClick={() => setAthleteId(a.id)}
              data-testid={`register-existing-athlete-${a.id}`}
              className={cn(
                "w-full text-left rounded-xl border px-4 py-3 transition-colors",
                a.on_event ? "border-border bg-secondary opacity-70 cursor-default"
                  : athleteId === a.id ? "border-brand bg-brand-tertiary/30" : "border-border bg-card hover:border-brand/50"
              )}
            >
              <p className="font-semibold text-sm">
                {a.first_name} {a.last_name}
                {a.on_event && <span className="text-xs font-normal text-success ml-2">✓ already registered for this event</span>}
              </p>
              <p className="text-xs text-muted-foreground font-mono-num">
                {a.date_of_birth || "DOB —"} · Grad {a.graduation_year || "—"}
              </p>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAthleteId(null)}
            data-testid="register-new-athlete-option"
            className={cn(
              "w-full text-left rounded-xl border border-dashed px-4 py-3 transition-colors",
              athleteId === null ? "border-brand bg-brand-tertiary/30" : "border-border hover:border-brand/50"
            )}
          >
            <p className="font-semibold text-sm">+ New athlete</p>
            <p className="text-xs text-muted-foreground">Register a different athlete in your family.</p>
          </button>
        </div>
      )}
      {selectedAthlete ? (
        <div className="rounded-xl border border-border bg-card px-4 py-3 space-y-1" data-testid="register-athlete-confirm">
          <p className="text-xs uppercase tracking-widest text-brand font-semibold">Registering</p>
          <p className="font-display text-2xl text-foreground">{selectedAthlete.first_name} {selectedAthlete.last_name}</p>
          <p className="text-sm text-muted-foreground font-mono-num">
            {selectedAthlete.date_of_birth || "DOB —"} · Grad {selectedAthlete.graduation_year || "—"}
          </p>
          <p className="text-xs text-muted-foreground">Their profile is already on file — no re-entry needed.</p>
        </div>
      ) : (
        newAthleteForm
      )}
    </div>
  );

  const profileStep = selectedAthlete ? (
    <div className="rounded-xl border border-border bg-card px-4 py-3 space-y-2" data-testid="register-profile-summary">
      <p className="text-xs uppercase tracking-widest text-brand font-semibold">Baseball profile on file</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div><p className="text-[10px] uppercase text-muted-foreground">Primary</p><p className="font-semibold">{selectedAthlete.primary_position || "—"}</p></div>
        <div><p className="text-[10px] uppercase text-muted-foreground">Secondary</p><p className="font-semibold">{(selectedAthlete.secondary_positions || []).join(", ") || "—"}</p></div>
        <div><p className="text-[10px] uppercase text-muted-foreground">Bats / Throws</p><p className="font-semibold">{selectedAthlete.bats || "—"} / {selectedAthlete.throws || "—"}</p></div>
        <div><p className="text-[10px] uppercase text-muted-foreground">Grad year</p><p className="font-semibold font-mono-num">{selectedAthlete.graduation_year || "—"}</p></div>
      </div>
    </div>
  ) : (
    <div className="space-y-4">
      <Field label="Primary position" required>
        <Select value={athlete.primary_position || undefined} onValueChange={setA("primary_position")}>
          <SelectTrigger className="h-11 rounded-xl" data-testid="register-primary-position-select"><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent>{POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Secondary positions" hint="Up to 2.">
        <div className="flex flex-wrap gap-2">
          {POSITIONS.filter((p) => p !== athlete.primary_position).map((p) => (
            <Chip
              key={p}
              active={athlete.secondary_positions.includes(p)}
              disabled={!athlete.secondary_positions.includes(p) && athlete.secondary_positions.length >= 2}
              onClick={() => toggleSecondary(p)}
              testid={`register-secondary-position-${p.toLowerCase()}`}
            >
              {p}
            </Chip>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bats" required>
          <Select value={athlete.bats || undefined} onValueChange={setA("bats")}>
            <SelectTrigger className="h-11 rounded-xl" data-testid="register-bats-select"><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="R">Right</SelectItem>
              <SelectItem value="L">Left</SelectItem>
              <SelectItem value="S">Switch</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Throws" required>
          <Select value={athlete.throws || undefined} onValueChange={setA("throws")}>
            <SelectTrigger className="h-11 rounded-xl" data-testid="register-throws-select"><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="R">Right</SelectItem>
              <SelectItem value="L">Left</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Current team / organization">
        <Input value={athlete.current_team} onChange={setA("current_team")} className="h-11 rounded-xl" data-testid="register-current-team-input" />
      </Field>
      <Field label="School">
        <Input value={athlete.school} onChange={setA("school")} className="h-11 rounded-xl" data-testid="register-school-input" />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="City">
          <Input value={athlete.city} onChange={setA("city")} className="h-11 rounded-xl" data-testid="register-city-input" />
        </Field>
        <Field label="State">
          <Input value={athlete.state} onChange={setA("state")} className="h-11 rounded-xl" data-testid="register-state-input" />
        </Field>
        <Field label="Years playing">
          <Input type="number" min="0" value={athlete.years_playing} onChange={setA("years_playing")} className="h-11 rounded-xl" data-testid="register-years-playing-input" />
        </Field>
      </div>
    </div>
  );

  const eventStep = (
    <div className="space-y-3">
      <Field label="Positions being evaluated" required hint="Pre-filled from the athlete's positions — adjust for this event.">
        <div className="flex flex-wrap gap-2">
          {evalPositionOptions.map((p) => (
            <Chip
              key={p}
              active={positionsEvaluated.includes(p)}
              onClick={() => toggleEvalPosition(p)}
              testid={`register-eval-position-${String(p).toLowerCase()}`}
            >
              {p}
            </Chip>
          ))}
        </div>
      </Field>
      {positionsEvaluated.length === 0 && (
        <p className="text-xs text-warning">Pick at least one position to be evaluated at this event.</p>
      )}
    </div>
  );

  const emergencyStep = (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Checkbox id="register-emergency-same" checked={sameAsParent} onCheckedChange={onSameAsParent} data-testid="register-emergency-same-checkbox" />
        <Label htmlFor="register-emergency-same" className="font-normal">Same as parent/guardian</Label>
      </div>
      <Field label="Emergency contact name" required>
        <Input required value={emergency.name} onChange={(e) => setEmergency((c) => ({ ...c, name: e.target.value }))} className="h-11 rounded-xl" data-testid="register-emergency-name-input" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Relationship" required>
          <Input required placeholder="e.g. Mother" value={emergency.relationship} onChange={(e) => setEmergency((c) => ({ ...c, relationship: e.target.value }))} className="h-11 rounded-xl" data-testid="register-emergency-relationship-input" />
        </Field>
        <Field label="Phone" required>
          <Input type="tel" required value={emergency.phone} onChange={(e) => setEmergency((c) => ({ ...c, phone: e.target.value }))} className="h-11 rounded-xl" data-testid="register-emergency-phone-input" />
        </Field>
      </div>
      <div className="space-y-2">
        <Label>
          Does staff need to know about any injury, physical limitation, allergy, medication requirement or other information for safe participation?
        </Label>
        <RadioGroup value={hasParticipationInfo} onValueChange={setHasParticipationInfo} className="flex gap-5" data-testid="register-participation-radio">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="yes" id="register-participation-yes" data-testid="register-participation-yes" />
            <Label htmlFor="register-participation-yes" className="font-normal">Yes</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="no" id="register-participation-no" data-testid="register-participation-no" />
            <Label htmlFor="register-participation-no" className="font-normal">No</Label>
          </div>
        </RadioGroup>
        {hasParticipationInfo === "yes" && (
          <div className="space-y-1.5">
            <Textarea
              value={participationNotes}
              onChange={(e) => setParticipationNotes(e.target.value)}
              placeholder="Anything staff should know for safe participation"
              className="rounded-xl min-h-[96px]"
              data-testid="register-participation-notes-input"
            />
            <p className="text-xs text-muted-foreground">This information is restricted — evaluators never see it.</p>
          </div>
        )}
      </div>
    </div>
  );

  const waiverText = consentInfo?.participation_waiver_text
    || "The participation waiver could not be loaded. Contact the organization before completing registration.";

  const waiversStep = (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-semibold">Participation waiver</p>
        <div className="max-h-48 overflow-y-auto rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground whitespace-pre-wrap" data-testid="register-waiver-text">
          {waiverText}
        </div>
        <ConsentCheck
          id="register-consent-waiver"
          checked={consents.participation_waiver}
          onChange={(v) => setConsents((c) => ({ ...c, participation_waiver: v }))}
          testid="register-consent-waiver-checkbox"
        >
          I acknowledge and accept the participation waiver. <span className="text-destructive">*</span>
        </ConsentCheck>
      </div>

      <ConsentCheck
        id="register-consent-emergency"
        checked={consents.emergency_authorization}
        onChange={(v) => setConsents((c) => ({ ...c, emergency_authorization: v }))}
        testid="register-consent-emergency-checkbox"
      >
        I authorize event staff to obtain emergency medical treatment for my athlete if needed. <span className="text-destructive">*</span>
      </ConsentCheck>

      <div className="space-y-2">
        <p className="text-sm font-semibold">Evaluation / profile media</p>
        <p className="text-xs text-muted-foreground">Photos and video captured for evaluation and the athlete&apos;s own profile.</p>
        <RadioGroup
          value={consents.evaluation_media}
          onValueChange={(v) => setConsents((c) => ({ ...c, evaluation_media: v }))}
          className="flex gap-5"
          data-testid="register-evaluation-media-radio"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="consent" id="register-eval-media-yes" data-testid="register-evaluation-media-consent" />
            <Label htmlFor="register-eval-media-yes" className="font-normal">Consent</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="decline" id="register-eval-media-no" data-testid="register-evaluation-media-decline" />
            <Label htmlFor="register-eval-media-no" className="font-normal">Do Not Consent</Label>
          </div>
        </RadioGroup>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold">Promotional / public media</p>
        <p className="text-xs text-muted-foreground">Use in the organization&apos;s promotional or public materials. Declining never blocks participation.</p>
        <RadioGroup
          value={consents.promotional_media}
          onValueChange={(v) => setConsents((c) => ({ ...c, promotional_media: v }))}
          className="flex gap-5"
          data-testid="register-promotional-media-radio"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="yes" id="register-promo-media-yes" data-testid="register-promotional-media-yes" />
            <Label htmlFor="register-promo-media-yes" className="font-normal">Yes</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="no" id="register-promo-media-no" data-testid="register-promotional-media-no" />
            <Label htmlFor="register-promo-media-no" className="font-normal">No</Label>
          </div>
        </RadioGroup>
      </div>

      <div className="space-y-2.5">
        <ConsentCheck
          id="register-consent-privacy"
          checked={consents.privacy_policy}
          onChange={(v) => setConsents((c) => ({ ...c, privacy_policy: v }))}
          testid="register-consent-privacy-checkbox"
        >
          I have read and agree to the <a href="/guide" target="_blank" rel="noreferrer" className="text-info hover:underline">Privacy Policy</a>. <span className="text-destructive">*</span>
        </ConsentCheck>
        <ConsentCheck
          id="register-consent-terms"
          checked={consents.terms}
          onChange={(v) => setConsents((c) => ({ ...c, terms: v }))}
          testid="register-consent-terms-checkbox"
        >
          I agree to the <a href="/guide" target="_blank" rel="noreferrer" className="text-info hover:underline">Terms of Service</a>. <span className="text-destructive">*</span>
        </ConsentCheck>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Public athlete profile</p>
          <p className="text-xs text-muted-foreground">Off by default for athletes under 18. You can enable this later.</p>
        </div>
        <Switch
          checked={consents.public_profile}
          onCheckedChange={(v) => setConsents((c) => ({ ...c, public_profile: !!v }))}
          data-testid="register-public-profile-toggle"
        />
      </div>
    </div>
  );

  const reviewAthleteName = selectedAthlete
    ? `${selectedAthlete.first_name} ${selectedAthlete.last_name}`
    : `${athlete.first_name} ${athlete.last_name}`.trim();
  const reviewSrc = selectedAthlete || athlete;
  const todayStr = new Date().toISOString().slice(0, 10);

  const reviewStep = (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card px-4 py-3 space-y-3" data-testid="register-review-summary">
        <div>
          <p className="text-xs uppercase tracking-widest text-brand font-semibold">Athlete</p>
          <p className="font-display text-2xl text-foreground">{reviewAthleteName}</p>
          <p className="text-sm text-muted-foreground font-mono-num">
            DOB {reviewSrc.date_of_birth || "—"} · Grad {reviewSrc.graduation_year || "—"} · Bats {reviewSrc.bats || "—"} / Throws {reviewSrc.throws || "—"}
          </p>
          <p className="text-sm text-muted-foreground">
            Positions: {[reviewSrc.primary_position, ...(reviewSrc.secondary_positions || [])].filter(Boolean).join(", ") || "—"}
          </p>
        </div>
        <div className="border-t border-divider pt-2">
          <p className="text-xs uppercase tracking-widest text-brand font-semibold">Event</p>
          <p className="text-sm font-semibold">{event?.name}</p>
          <p className="text-sm text-muted-foreground">Evaluated at: {positionsEvaluated.join(", ")}</p>
        </div>
        <div className="border-t border-divider pt-2 space-y-1 text-sm">
          <p className="text-xs uppercase tracking-widest text-brand font-semibold">Permissions</p>
          <div className="flex justify-between gap-2"><span className="text-muted-foreground">Participation waiver</span><span className="font-semibold">Accepted</span></div>
          <div className="flex justify-between gap-2"><span className="text-muted-foreground">Emergency treatment</span><span className="font-semibold">Authorized</span></div>
          <div className="flex justify-between gap-2"><span className="text-muted-foreground">Evaluation media</span><span className="font-semibold">{consents.evaluation_media === "consent" ? "Consent" : "Do Not Consent"}</span></div>
          <div className="flex justify-between gap-2"><span className="text-muted-foreground">Promotional media</span><span className="font-semibold">{consents.promotional_media === "yes" ? "Yes" : "No"}</span></div>
          <div className="flex justify-between gap-2"><span className="text-muted-foreground">Privacy / Terms</span><span className="font-semibold">Agreed</span></div>
          <div className="flex justify-between gap-2"><span className="text-muted-foreground">Public profile</span><span className="font-semibold">{consents.public_profile ? "On" : "Off"}</span></div>
        </div>
      </div>

      <Field label="Electronic signature — full legal name" required>
        <Input
          required
          placeholder="Full legal name"
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          className="h-11 rounded-xl"
          data-testid="register-signature-input"
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        I certify I am the athlete&apos;s parent/legal guardian or otherwise authorized to register this athlete, and that the information provided is accurate.
        {" "}Signed <span className="font-mono-num">{todayStr}</span>.
      </p>

      <Button
        onClick={submit}
        disabled={busy || !stepValid("review")}
        className="w-full h-12 rounded-full bg-brand hover:bg-brand-secondary text-base font-semibold active:scale-[0.98] transition"
        data-testid="register-submit-button"
      >
        {busy ? "Registering…" : "REGISTER ATHLETE"}
      </Button>
    </div>
  );

  const bodies = {
    parent: parentStep,
    athlete: athleteStep,
    profile: profileStep,
    event: eventStep,
    emergency: emergencyStep,
    waivers: waiversStep,
    review: reviewStep,
  };

  return (
    <Shell>
      {eventHeader}

      {signedIn && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm" data-testid="register-signed-in-banner">
          <UserRound className="h-4 w-4 text-brand shrink-0" />
          <span className="text-muted-foreground">Registering as <span className="font-semibold text-foreground">{user.full_name}</span></span>
        </div>
      )}

      <Card className="rounded-2xl border-border bg-card">
        <CardContent className="pt-5 pb-6 space-y-5">
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold" data-testid="register-step-label">{step.label}</p>
              <p className="text-xs text-muted-foreground font-mono-num">Step {stepIdx + 1} of {steps.length}</p>
            </div>
            <Progress value={((stepIdx + 1) / steps.length) * 100} className="h-2" data-testid="register-progress" />
          </div>

          <div data-testid={`register-step-${step.id}`}>{bodies[step.key]}</div>

          <div className="flex gap-3 pt-1">
            {stepIdx > 0 && (
              <Button type="button" variant="outline" onClick={goBack} className="h-11 rounded-xl flex-1" data-testid="register-back-button">
                Back
              </Button>
            )}
            {step.key !== "review" && (
              <Button
                type="button"
                onClick={goNext}
                disabled={!stepValid(step.key)}
                className="h-11 rounded-xl flex-1 bg-primary hover:bg-brand-secondary font-semibold"
                data-testid="register-next-button"
              >
                Next
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {!signedIn && (
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/signin" className="text-info hover:underline" data-testid="register-signin-link">Sign in</Link>
          {" "}to register faster.
        </p>
      )}
    </Shell>
  );
}
