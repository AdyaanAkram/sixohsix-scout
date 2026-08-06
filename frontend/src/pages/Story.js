import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { formatPermanentId } from "@/lib/utils";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { TimelineItem } from "@/components/common/TimelineItem";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ShieldCheck } from "lucide-react";

export default function Story() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get(`/public/story/${slug}`)
      .then((r) => setData(r.data))
      .catch((e) => setErr(errMsg(e, "Story not found.")));
  }, [slug]);

  if (err) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4" data-testid="story-not-found">
        <div className="text-center space-y-3">
          <p className="font-display text-3xl text-foreground">Story unavailable</p>
          <p className="text-sm text-muted-foreground">{err}</p>
          <Link to="/" className="text-sm text-info hover:underline">Home</Link>
        </div>
      </div>
    );
  }
  if (!data) return <div className="min-h-screen bg-background p-6"><Skeleton className="h-40 rounded-2xl max-w-lg mx-auto" /></div>;

  const [first, ...rest] = (data.player_name || "").split(" ");
  const last = rest.join(" ");
  const entries = data.entries || [];
  const longBio = (data.bio || "").length > 160;

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="public-story-page">
      <header className="border-b border-border px-4 py-3 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-brand" />
        <span className="font-display text-lg">60&apos;6&quot;</span>
        <span className="text-xs text-muted-foreground ml-auto">{data.organization_name}</span>
      </header>
      <main className="max-w-lg mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <PlayerAvatar firstName={first} lastName={last} size="hero" photoUrl={data.photo_url} />
          <div className="min-w-0">
            <h1 className="font-display text-3xl">{data.player_name}</h1>
            <p className="text-sm text-muted-foreground">
              {data.age_group || "—"} · {data.primary_position || "—"}
            </p>
            {data.athlete_id && (
              <p className="text-sm font-mono-num text-brand mt-1" data-testid="story-permanent-id">
                {formatPermanentId(data.athlete_id)}
              </p>
            )}
          </div>
        </div>

        {data.bio && (longBio ? (
          <Collapsible>
            <CollapsibleTrigger className="text-xs text-info hover:underline">View Details</CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <p className="text-sm text-muted-foreground">{data.bio}</p>
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <p className="text-sm text-muted-foreground">{data.bio}</p>
        ))}

        <div>
          <p className="text-xs uppercase tracking-widest text-brand font-semibold mb-3">ID Story</p>
          <div className="space-y-2">
            {entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No public milestones yet.</p>
            ) : (
              entries.map((e, i) => <TimelineItem key={i} entry={e} />)
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
