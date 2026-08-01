import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";

const HERO_IMG =
  "https://images.pexels.com/photos/269948/pexels-photo-269948.jpeg";

export default function Landing() {
  const { user, loading } = useAuth();

  if (!loading && user) {
    const home = user.role === "athlete" || user.role === "parent" ? "/my-id" : "/dashboard";
    return <Navigate to={home} replace />;
  }

  return (
    <div className="landing-root min-h-screen bg-background text-foreground" data-testid="landing-page">
      {/* Full-bleed hero plane */}
      <section className="relative min-h-[100dvh] overflow-hidden flex flex-col">
        <div
          className="absolute inset-0 landing-hero-img"
          style={{ backgroundImage: `url(${HERO_IMG})` }}
          aria-hidden
        />
        <div className="absolute inset-0 landing-hero-veil" aria-hidden />

        {/* Top bar — brand + sign in */}
        <header className="relative z-10 flex items-center justify-between px-5 sm:px-8 pt-5 sm:pt-7">
          <p className="font-display text-2xl sm:text-3xl tracking-tight text-foreground landing-fade-in">
            60&apos;6&quot;
          </p>
          <Button
            asChild
            variant="outline"
            className="rounded-full h-10 px-5 border-border bg-surface-2/40 text-foreground hover:bg-surface-3 hover:text-foreground landing-fade-in landing-delay-1"
          >
            <Link to="/signin" data-testid="landing-signin-link">Sign in</Link>
          </Button>
        </header>

        {/* Hero copy — bottom-anchored like Velo welcome */}
        <div className="relative z-10 mt-auto px-5 sm:px-8 pb-12 sm:pb-16 max-w-3xl">
          <h1 className="font-display text-[clamp(3.25rem,12vw,5.5rem)] leading-[0.95] tracking-[-0.04em] text-foreground landing-rise">
            60&apos;6&quot;{" "}
            <span className="text-brand">ID.</span>
          </h1>
          <p className="mt-5 sm:mt-6 text-lg sm:text-xl font-semibold text-foreground leading-snug max-w-md landing-rise landing-delay-1">
            Every player. Every rep. Every swing has a{" "}
            <span className="text-brand">story.</span>
          </p>
          <p className="mt-3 text-sm sm:text-base text-muted-foreground max-w-md leading-relaxed landing-rise landing-delay-2">
            Identify. Evaluate. Develop. Train. — one permanent athletic identity for camps, clinics, and growth.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row gap-3 sm:items-center landing-rise landing-delay-3">
            <Button
              asChild
              className="rounded-full h-14 px-8 text-base font-bold bg-brand hover:bg-brand-secondary text-primary-foreground"
            >
              <Link to="/signin" data-testid="landing-cta-signin">Sign in</Link>
            </Button>
            <p className="text-xs text-muted-foreground sm:ml-2">
              Staff, coaches, athletes &amp; guardians
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
