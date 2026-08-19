import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Compass, ArrowRight } from "lucide-react";

/**
 * Unknown URL. Previously the router bounced these to "/", which sent a
 * signed-in user through the landing page's redirect and dumped them on the
 * mode picker with no explanation — it read like being kicked out of the app.
 * Now the address is named and the way back is explicit.
 */
export default function NotFound() {
  const { user } = useAuth();
  const home = user
    ? (user.role === "athlete" || user.role === "parent" ? "/my-id" : "/workspace")
    : "/";
  return (
    <div className="min-h-screen bg-background hero-sweep flex flex-col items-center justify-center px-5 text-center" data-testid="not-found-page">
      <div className="relative z-10 max-w-md">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-tertiary ring-1 ring-brand/40">
          <Compass className="h-7 w-7 text-brand" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Page not found</p>
        <h1 className="mt-2 font-display text-4xl text-foreground">This page doesn&apos;t exist.</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The link may be out of date, or the address has a typo. Nothing is wrong with your account.
        </p>
        <code className="mt-3 block truncate rounded-lg bg-secondary px-3 py-2 font-mono-num text-xs text-muted-foreground">
          {window.location.pathname}
        </code>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button asChild className="rounded-xl h-11 bg-primary hover:bg-brand-secondary">
            <Link to={home} data-testid="not-found-home">
              {user ? "Back to the app" : "Go to the home page"} <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
          {user && (
            <Button asChild variant="outline" className="rounded-xl h-11">
              <Link to="/players" data-testid="not-found-players">Athletes</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
