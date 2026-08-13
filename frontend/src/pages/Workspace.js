import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
  WORKSPACE_META, WORKSPACE_HOME, getAuthorizedWorkspaces, getActiveWorkspace,
  persistWorkspace, useWorkspace,
} from "@/components/layout/AppLayout";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Full-screen workspace chooser — "Where are you working today?"
 * One card per AUTHORIZED workspace only (a workspace is a lens, not an access
 * grant — roles the account isn't entitled to are never shown). Tapping a card
 * persists the choice per user and routes to that workspace's home. Returning
 * users are never forced back here: AppLayout only redirects to /workspace when
 * a multi-workspace user has no stored choice yet.
 */
export default function Workspace() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const wsCtx = useWorkspace();
  const workspaces = getAuthorizedWorkspaces(user?.role);
  const current = getActiveWorkspace(user);

  const choose = (key) => {
    if (!workspaces.includes(key)) return;
    if (wsCtx?.switchWorkspace) {
      wsCtx.switchWorkspace(key); // persists + navigates + updates layout state
      return;
    }
    persistWorkspace(user?.id, key);
    navigate(WORKSPACE_HOME[key] || "/dashboard");
  };

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center py-10" data-testid="workspace-chooser">
      <div className="flex items-center gap-2.5 mb-8">
        <div className="h-10 w-10 rounded-xl bg-brand-tertiary flex items-center justify-center ring-1 ring-brand/50">
          <span className="font-display text-xs font-extrabold text-brand leading-none">60</span>
        </div>
        <div className="leading-none">
          <p className="font-display text-2xl text-foreground">60&apos;6&quot; ID</p>
          <p className="text-[10px] text-muted-foreground tracking-wide uppercase">
            {user?.organization_name || "Athletics"}
          </p>
        </div>
      </div>

      <h1 className="font-display text-3xl sm:text-4xl text-foreground text-center">
        Where are you working today?
      </h1>
      <p className="text-sm text-muted-foreground mt-2 text-center">
        Welcome back{user?.full_name ? `, ${user.full_name.split(" ")[0]}` : ""}. Pick a workspace — you can
        switch anytime without signing out.
      </p>

      <div
        className={cn(
          "mt-8 grid gap-3 w-full max-w-3xl",
          workspaces.length > 1 ? "sm:grid-cols-2" : "max-w-md"
        )}
      >
        {workspaces.map((key) => {
          const meta = WORKSPACE_META[key];
          if (!meta) return null;
          const Icon = meta.icon;
          const active = key === current;
          return (
            <button
              key={key}
              type="button"
              onClick={() => choose(key)}
              data-testid={`workspace-card-${key}`}
              className={cn(
                "group flex items-center gap-4 rounded-2xl border bg-card px-5 py-5 text-left transition-all",
                "hover:bg-secondary/60 hover:ring-1 hover:ring-ring/40 active:scale-[0.98]",
                active ? "border-brand/60 ring-1 ring-brand/40" : "border-border"
              )}
            >
              <div className="h-12 w-12 rounded-xl bg-brand-tertiary ring-1 ring-brand/40 flex items-center justify-center shrink-0">
                <Icon className="h-6 w-6 text-brand" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-display text-xl text-foreground">{meta.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{meta.blurb}</p>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
