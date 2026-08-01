import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { IdRadarChart } from "@/components/common/IdRadarChart";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Pencil, TrendingUp, Share2, Trophy } from "lucide-react";

export default function MyId() {
  const [athlete, setAthlete] = useState(null);
  const [summary, setSummary] = useState(null);
  const [evals, setEvals] = useState([]);
  const [card, setCard] = useState(null);
  const [metricsPack, setMetricsPack] = useState({ metrics: [], milestones: [] });
  const [awards, setAwards] = useState([]);
  const [pendingMedia, setPendingMedia] = useState([]);

  const reload = () => {
    Promise.all([
      api.get("/me/athlete"),
      api.get("/me/evaluations"),
      api.get("/me/id-card"),
      api.get("/me/summary"),
      api.get("/me/metrics").catch(() => ({ data: { metrics: [], milestones: [] } })),
      api.get("/me/awards").catch(() => ({ data: [] })),
      api.get("/media/pending-consent").catch(() => ({ data: [] })),
    ]).then(([a, e, c, s, m, aw, pm]) => {
      setAthlete(a.data);
      setEvals(e.data || []);
      setCard(c.data);
      setSummary(s.data);
      setMetricsPack(m.data || { metrics: [], milestones: [] });
      setAwards(aw.data || []);
      setPendingMedia(pm.data || []);
    }).catch((err) => toast.error(errMsg(err)));
  };

  useEffect(reload, []);

  const togglePublic = async (on) => {
    try {
      await api.patch("/me/athlete", { public_enabled: on });
      toast.success(on ? "Public ID Story enabled." : "Story is private again.");
      reload();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const resolveConsent = async (mediaId, approve) => {
    try {
      await api.post(`/media/${mediaId}/consent`, { approve });
      toast.success(approve ? "Media approved." : "Media rejected.");
      reload();
    } catch (e) { toast.error(errMsg(e)); }
  };

  if (!athlete) {
    return <div className="space-y-3"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>;
  }

  const cats = summary?.category_scores || {};
  const radarData = Object.entries(cats).map(([name, d]) => ({ category: name, score: d.score }));
  const incomplete = !athlete.bio || !athlete.photo_url;
  const qrUrl = card?.qr_payload
    ? `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(card.qr_payload)}`
    : null;

  return (
    <div className="space-y-5 max-w-3xl" data-testid="my-id-page">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-brand font-semibold">My ID</p>
          <h1 className="font-display text-4xl text-foreground mt-1">
            {athlete.first_name} {athlete.last_name}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {athlete.age_group || "—"} · {athlete.primary_position || "—"}
          </p>
        </div>
        <Button asChild className="rounded-xl bg-primary hover:bg-brand-secondary h-11">
          <Link to="/my-id/edit" data-testid="my-id-edit-link"><Pencil className="h-4 w-4 mr-1.5" /> Edit</Link>
        </Button>
      </div>

      {incomplete && (
        <Card className="rounded-2xl border-brand/40 bg-brand-tertiary">
          <CardContent className="py-4 flex items-center justify-between gap-3">
            <p className="text-sm text-accent-foreground">Complete your profile — add a bio and photo to unlock your full ID Card.</p>
            <Button asChild variant="outline" className="rounded-xl shrink-0 border-brand text-brand">
              <Link to="/my-id/edit">Finish</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {pendingMedia.length > 0 && (
        <Card className="rounded-2xl border-warning/40 bg-warning/10">
          <CardContent className="py-4 space-y-2">
            <p className="text-sm font-semibold text-warning">Media awaiting your consent</p>
            {pendingMedia.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{m.file_type} · {m.description || "Upload"}</span>
                <div className="flex gap-2">
                  <Button size="sm" className="rounded-lg h-8" onClick={() => resolveConsent(m.id, true)}>Approve</Button>
                  <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => resolveConsent(m.id, false)}>Reject</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ID Card */}
      <Card className="rounded-2xl border-border overflow-hidden" data-testid="id-card">
        <div className="hero-sweep px-5 py-5 flex flex-wrap gap-4 items-center">
          <PlayerAvatar firstName={athlete.first_name} lastName={athlete.last_name} size="lg" photoUrl={athlete.photo_url} />
          <div className="flex-1 min-w-[160px]">
            <p className="font-display text-2xl text-foreground">{card?.name}</p>
            <p className="text-sm text-muted-foreground">{card?.primary_position} · {card?.age_group}</p>
            <p className="text-3xl font-bold font-mono-num text-brand mt-2">{card?.headline_overall ?? "—"}</p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Headline overall</p>
            {(card?.highlight_metrics || []).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {card.highlight_metrics.map((h) => (
                  <span key={h.key} className="rounded-full border border-border px-2.5 py-0.5 text-xs font-mono-num">
                    {h.label}: {h.value}{h.unit ? ` ${h.unit}` : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
          {qrUrl && (
            <div className="text-center">
              <img src={qrUrl} alt="ID QR" className="rounded-xl border border-border bg-white p-1 w-28 h-28 mx-auto" data-testid="id-card-qr" />
              <p className="text-[10px] text-muted-foreground mt-1 max-w-[8rem]">Scan for ID Story</p>
            </div>
          )}
        </div>
        <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3 border-t border-divider">
          <div className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-brand" />
            <div>
              <p className="text-sm font-semibold">Public ID Story</p>
              <p className="text-xs text-muted-foreground">Parents can open your share link when enabled.</p>
            </div>
          </div>
          <Switch checked={!!card?.public_enabled} onCheckedChange={togglePublic} data-testid="public-story-toggle" />
          {card?.story_url && (
            <a href={card.story_url} target="_blank" rel="noreferrer" className="text-xs text-info hover:underline w-full truncate" data-testid="story-link">
              {card.story_url}
            </a>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border bg-card">
        <CardContent className="pt-4 pb-2">
          <p className="font-semibold text-sm text-foreground mb-1 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-brand" /> Skill radar
          </p>
          {radarData.length >= 3 ? (
            <IdRadarChart data={radarData} />
          ) : (
            <p className="text-sm text-muted-foreground py-10 text-center">
              Your radar fills in after coaches submit evaluations.
            </p>
          )}
        </CardContent>
      </Card>

      {(metricsPack.milestones || []).length > 0 && (
        <Card className="rounded-2xl border-border">
          <CardContent className="pt-4 pb-4 space-y-2">
            <p className="font-semibold text-sm flex items-center gap-2"><Trophy className="h-4 w-4 text-brand" /> Milestones</p>
            {metricsPack.milestones.slice(0, 8).map((ms) => (
              <div key={ms.id} className="text-sm border-b border-divider pb-2 last:border-0">
                <p className="font-semibold">{ms.label}</p>
                <p className="text-xs text-muted-foreground">{ms.detail}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {(metricsPack.metrics || []).length > 0 && (
        <Card className="rounded-2xl border-border">
          <CardContent className="pt-4 pb-4">
            <p className="font-semibold text-sm mb-3">Verified metrics</p>
            <div className="space-y-2">
              {metricsPack.metrics.slice(0, 10).map((m) => (
                <div key={m.id} className="flex justify-between text-sm border-b border-divider pb-2 last:border-0">
                  <span className="text-muted-foreground capitalize">{m.metric_key.replace(/_/g, " ")}</span>
                  <span className="font-mono-num font-semibold">{m.value} {m.unit}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {awards.length > 0 && (
        <Card className="rounded-2xl border-border">
          <CardContent className="pt-4 pb-4 space-y-2">
            <p className="font-semibold text-sm">Awards</p>
            {awards.map((a) => (
              <div key={a.id} className="text-sm flex justify-between gap-2">
                <span>{a.title}</span>
                <span className="text-xs text-muted-foreground capitalize">{a.status}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div>
        <p className="font-semibold text-sm text-foreground mb-2">Evaluation timeline</p>
        {evals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No submitted evaluations yet.</p>
        ) : (
          <div className="space-y-2">
            {evals.map((ev) => (
              <div key={ev.id} className="rounded-xl border border-border bg-card px-4 py-3 flex justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">{ev.event_name || "Event"}</p>
                  <p className="text-xs text-muted-foreground">{ev.station_name} · {ev.event_date || "—"}</p>
                </div>
                <p className="font-mono-num font-bold text-lg text-brand">
                  {ev.computed?.overall_score ?? "—"}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
