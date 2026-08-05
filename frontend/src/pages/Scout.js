import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { ClipboardList, GitCompare, Flag, ArrowRight } from "lucide-react";

const ACTIONS = [
  {
    to: "/review",
    icon: ClipboardList,
    title: "Review Queue",
    hint: "Approve or return submitted evaluations — Scout Mode quality control.",
    testId: "scout-review-link",
  },
  {
    to: "/scout/compare",
    icon: GitCompare,
    title: "Compare Players",
    hint: "Side-by-side cards and charts for up to four athletes.",
    testId: "scout-compare-link",
  },
  {
    to: "/reports",
    icon: Flag,
    title: "Rankings & Reports",
    hint: "Event rankings, category leaders, and evaluator differences.",
    testId: "scout-reports-link",
  },
];

export default function Scout() {
  return (
    <div className="space-y-5" data-testid="scout-mode-page">
      <div>
        <p className="text-[10px] uppercase tracking-[0.16em] text-brand font-semibold">60&apos;6&quot; Scout Mode</p>
        <h1 className="font-display text-4xl text-foreground mt-1">Scout</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-xl">
          Evaluation review, player comparison, and ranking tools for coaches and scouts.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {ACTIONS.map(({ to, icon: Icon, title, hint, testId }) => (
          <Link key={to} to={to} data-testid={testId}>
            <Card className="rounded-2xl border-border h-full hover:border-brand/50 transition-colors">
              <CardContent className="pt-5 pb-5 space-y-3">
                <div className="h-11 w-11 rounded-xl bg-brand-tertiary flex items-center justify-center">
                  <Icon className="h-5 w-5 text-brand" />
                </div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-foreground">{title}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{hint}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
