import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="public-story-page">
      <header className="border-b border-border px-4 py-3 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-brand" />
        <span className="font-display text-lg">60&apos;6&quot;</span>
        <span className="text-xs text-muted-foreground ml-auto">{data.organization_name}</span>
      </header>
      <main className="max-w-lg mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <PlayerAvatar firstName={first} lastName={last} size="lg" photoUrl={data.photo_url} />
          <div>
            <h1 className="font-display text-3xl">{data.player_name}</h1>
            <p className="text-sm text-muted-foreground">
              {data.age_group || "—"} · {data.primary_position || "—"}
            </p>
          </div>
        </div>
        {data.bio && <p className="text-sm text-muted-foreground">{data.bio}</p>}

        <div>
          <p className="text-xs uppercase tracking-widest text-brand font-semibold mb-3">ID Story</p>
          <div className="space-y-2">
            {(data.entries || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No public milestones yet.</p>
            ) : (
              data.entries.map((e, i) => (
                <Card key={i} className="rounded-2xl border-border">
                  <CardContent className="py-3">
                    <div className="flex justify-between gap-2">
                      <div>
                        <p className="text-xs text-muted-foreground capitalize">{e.kind} · {(e.date || "").slice(0, 10)}</p>
                        <p className="text-sm font-semibold text-foreground">{e.title}</p>
                        {e.subtitle && <p className="text-xs text-muted-foreground mt-0.5">{e.subtitle}</p>}
                      </div>
                      {e.verified && <span className="text-[10px] font-semibold text-success border border-success/40 rounded-full px-2 py-0.5 h-fit">Verified</span>}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
