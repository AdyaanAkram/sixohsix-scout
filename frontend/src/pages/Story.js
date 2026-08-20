import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { formatPermanentId } from "@/lib/utils";
import { resolvePhotoSrc } from "@/components/common/PlayerAvatar";
import { TimelineItem } from "@/components/common/TimelineItem";
import { VerificationBadge, isVerifiedSource } from "@/components/common/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ShieldCheck } from "lucide-react";

/* Tiny uppercase panel header — the card anatomy every other page in the app uses. */
const PanelLabel = ({ children }) => (
  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>
);

/*
  Photo header, same idiom as the portal hero. On a public story the fallback is
  the common case, not the exception: photo_url is stored as /api/media/{id}/file
  and that route needs a token, so an anonymous visitor's <img> fails and lands
  here. The monogram panel has to look deliberate, because usually it is what a
  relative actually sees.
*/
const CardPhoto = ({ name, photoUrl, position }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [photoUrl]);
  const src = !failed ? resolvePhotoSrc(photoUrl) : null;
  if (src) {
    return (
      <img
        src={src}
        alt={name || "Player"}
        className="h-full w-full object-cover object-top"
        onError={() => setFailed(true)}
      />
    );
  }
  const [first = "", last = ""] = String(name || "").split(" ");
  const initials = `${first[0] || "?"}${last[0] || ""}`.toUpperCase();
  return (
    <div className="relative flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-tertiary via-secondary to-background">
      {position && (
        <span className="absolute -right-2 bottom-0 select-none font-display text-7xl font-extrabold leading-none text-foreground/[0.06]">
          {position}
        </span>
      )}
      <span className="select-none font-display text-5xl text-brand/70">{initials}</span>
    </div>
  );
};

/* One measured number, chip-sized — the portal's MeasurementChip anatomy. */
const MeasurementChip = ({ m }) => (
  <div className="min-w-0 rounded-xl border border-border bg-card px-3 py-2.5" data-testid={`story-measurement-${m.key}`}>
    <div className="flex items-center gap-1.5">
      <p className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {m.label}
      </p>
      {m.source && <VerificationBadge source={m.source} iconOnly />}
    </div>
    <div className="mt-1 flex items-baseline gap-1">
      <span className="font-mono-num text-2xl font-bold leading-none text-foreground">{m.value}</span>
      {m.unit && <span className="truncate text-xs text-muted-foreground">{m.unit}</span>}
    </div>
  </div>
);

/*
  A public story carries no measurement fields of its own — the numbers live in
  the timeline entries, where the API writes `subtitle` as "{value} {unit}".
  Split on the first space so the number can be typeset on its own. This reads
  the payload the page already has; it never justifies a second request.
*/
const splitMeasurement = (subtitle) => {
  const raw = String(subtitle || "").trim();
  if (!raw) return null;
  const i = raw.indexOf(" ");
  return i === -1 ? { value: raw, unit: "" } : { value: raw.slice(0, i), unit: raw.slice(i + 1) };
};

/*
  The API formats an evaluation subtitle as "Overall {score}", falling back to a
  bare dash — and to the literal "None" when the key exists but is null. Neither
  belongs on the page a family shares with relatives, so an unscored evaluation
  says so in words instead.
*/
const UNSCORED_SUBTITLE = /^Overall\s*(—|–|-|None|null|undefined)?$/i;
const humanizeEntry = (e) =>
  e.kind === "evaluation" && UNSCORED_SUBTITLE.test(String(e.subtitle || "").trim())
    ? { ...e, subtitle: "Not scored yet" }
    : e;

export default function Story() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get(`/public/story/${slug}`)
      .then((r) => setData(r.data))
      .catch((e) => setErr(errMsg(e, "Story not found.")));
  }, [slug]);

  // ---- every hook is above these early returns; nothing below may add one ----
  if (err) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4" data-testid="story-not-found">
        <div className="space-y-3 text-center">
          <p className="font-display text-3xl text-foreground">Story unavailable</p>
          <p className="text-sm text-muted-foreground">{err}</p>
          <Link to="/" className="text-sm text-info hover:underline">Home</Link>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="mx-auto max-w-2xl space-y-4">
          <Skeleton className="h-56 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      </div>
    );
  }

  const entries = (data.entries || []).map(humanizeEntry);
  const longBio = (data.bio || "").length > 160;

  // Latest reading per measurement. The API returns entries newest-first, so the
  // first row for a title is the current one.
  const measurements = [];
  const seenMetrics = new Set();
  for (const e of entries) {
    if (e.kind !== "metric" || seenMetrics.has(e.title)) continue;
    const parsed = splitMeasurement(e.subtitle);
    if (!parsed) continue;
    seenMetrics.add(e.title);
    measurements.push({ key: e.title, label: e.title, source: e.verification_source, ...parsed });
  }
  const topMeasurements = measurements.slice(0, 6);
  const verifiedCount = entries.filter((e) => isVerifiedSource(e.verification_source)).length;

  // Only facts the payload actually carries — never a bare dash as a placeholder.
  const identityBits = [data.age_group, data.primary_position].filter(Boolean);

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="public-story-page">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <ShieldCheck className="h-5 w-5 shrink-0 text-brand" />
        <span className="font-display text-lg">60&apos;6&quot;</span>
        {data.organization_name && (
          <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">{data.organization_name}</span>
        )}
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6 sm:py-8">
        {/* ---------------------------- HERO ---------------------------- */}
        <Card className="overflow-hidden rounded-2xl border-border" data-testid="story-hero">
          <div className="hero-sweep p-4 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
              <div className="mx-auto h-36 w-36 shrink-0 overflow-hidden rounded-2xl ring-2 ring-brand/40 sm:mx-0 sm:h-44 sm:w-44">
                <CardPhoto name={data.player_name} photoUrl={data.photo_url} position={data.primary_position} />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-brand">60&apos;6&quot; ID Story</p>
                  <h1 className="mt-1 break-words font-display text-3xl leading-tight text-foreground sm:text-4xl">
                    {data.player_name}
                  </h1>
                  {identityBits.length > 0 && (
                    <p className="mt-1.5 break-words text-sm text-muted-foreground">{identityBits.join(" · ")}</p>
                  )}
                </div>

                {/* The permanent ID, worn like an ID badge. */}
                {data.athlete_id && (
                  <div className="inline-flex max-w-full flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-brand/40 bg-brand/10 px-3 py-2">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-brand/80">Permanent ID</span>
                    <span className="break-all font-mono-num text-sm font-bold text-brand" data-testid="story-permanent-id">
                      {formatPermanentId(data.athlete_id)}
                    </span>
                  </div>
                )}

                {verifiedCount > 0 && (
                  <p
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-success/40 bg-success/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-success"
                    data-testid="story-verified-pill"
                  >
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0">{verifiedCount} verified by coaches</span>
                  </p>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* ------------------------ MEASUREMENTS ------------------------ */}
        {topMeasurements.length > 0 && (
          <Card className="rounded-2xl border-border bg-card" data-testid="story-measurements">
            <CardContent className="pt-4 pb-4">
              <PanelLabel>What coaches measured</PanelLabel>
              <p className="mt-1 text-xs text-muted-foreground">
                Every number here was taken by a coach at a 60&apos;6&quot; camp — nothing is estimated.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {topMeasurements.map((m) => (
                  <MeasurementChip key={m.key} m={m} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ---------------------------- BIO ----------------------------- */}
        {data.bio && (
          <Card className="rounded-2xl border-border bg-card" data-testid="story-bio">
            <CardContent className="space-y-2 pt-4 pb-4">
              <PanelLabel>About</PanelLabel>
              {longBio ? (
                <Collapsible>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {data.bio.slice(0, 160).trimEnd()}…
                  </p>
                  <CollapsibleTrigger className="mt-1 text-xs text-info hover:underline">
                    View Details
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2">
                    <p className="text-sm leading-relaxed text-muted-foreground">{data.bio}</p>
                  </CollapsibleContent>
                </Collapsible>
              ) : (
                <p className="text-sm leading-relaxed text-muted-foreground">{data.bio}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* --------------------------- TIMELINE -------------------------- */}
        <Card className="rounded-2xl border-border bg-card" data-testid="story-timeline">
          <CardContent className="space-y-3 pt-4 pb-4">
            <div className="min-w-0">
              <PanelLabel>The story so far</PanelLabel>
              <p className="mt-1 text-xs text-muted-foreground">
                Camps, measurements and milestones, newest first.
              </p>
            </div>
            <div className="space-y-2">
              {entries.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No public milestones yet — this fills in after the next camp.
                </p>
              ) : (
                entries.map((e, i) => <TimelineItem key={i} entry={e} />)
              )}
            </div>
          </CardContent>
        </Card>

        <p className="px-1 pb-2 text-center text-xs text-muted-foreground">
          A 60&apos;6&quot; ID is a permanent, coach-verified record of an athlete&apos;s development.
        </p>
      </main>
    </div>
  );
}
