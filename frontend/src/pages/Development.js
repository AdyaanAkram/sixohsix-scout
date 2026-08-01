import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PlayerAvatar } from "@/components/common/PlayerAvatar";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Target, StickyNote } from "lucide-react";

export default function Development() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/development/overview").then((r) => setData(r.data)).catch(() => setData({ goals: [], recent_assessments: [] }));
  }, []);

  if (!data) return <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-4xl text-foreground">Development</h1>
        <p className="text-sm text-muted-foreground">Active goals and recent coach assessments across the program.</p>
      </div>

      <section className="space-y-2">
        <h2 className="font-display text-2xl text-foreground flex items-center gap-2"><Target className="h-5 w-5 text-destructive" /> Active Goals</h2>
        {data.goals.length === 0 ? (
          <EmptyState icon={Target} title="No active goals" hint="Create development goals from any player profile." />
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {data.goals.map((g) => (
              <Card key={g.id} className="rounded-2xl border-border">
                <CardContent className="py-4">
                  <div className="flex items-center gap-3">
                    <PlayerAvatar firstName={g.athlete?.first_name} lastName={g.athlete?.last_name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <Link to={`/players/${g.athlete_id}?tab=development`} className="text-sm font-semibold text-foreground hover:underline truncate block">
                        {g.athlete ? `${g.athlete.first_name} ${g.athlete.last_name}` : "Player"}
                      </Link>
                      <p className="text-xs text-muted-foreground truncate">{g.title}</p>
                    </div>
                    <StatusBadge status={g.status} />
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <Progress value={g.progress} className="h-2 flex-1" />
                    <span className="text-xs font-mono-num text-muted-foreground">{g.progress}%</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-2xl text-foreground flex items-center gap-2"><StickyNote className="h-5 w-5 text-info" /> Recent Assessments</h2>
        {data.recent_assessments.length === 0 ? (
          <EmptyState icon={StickyNote} title="No assessments yet" hint="Year-to-date coach assessments appear here." />
        ) : (
          <div className="space-y-2">
            {data.recent_assessments.map((n) => (
              <Card key={n.id} className="rounded-2xl border-border">
                <CardContent className="py-3.5">
                  <div className="flex items-center justify-between">
                    <Link to={`/players/${n.athlete_id}?tab=notes`} className="text-sm font-semibold text-foreground hover:underline">
                      {n.athlete ? `${n.athlete.first_name} ${n.athlete.last_name}` : "Player"}
                    </Link>
                    <span className="text-xs text-muted-foreground">{n.assessment_date}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{n.assessment_type} · {n.author_name}</p>
                  {n.strengths && <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">{n.strengths}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
