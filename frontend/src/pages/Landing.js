import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PublicNav, PublicFooter, useReveal } from "@/components/marketing/PublicShell";
import {
  QrCode,
  ClipboardCheck,
  MousePointerClick,
  Sparkles,
  TrendingUp,
  Fingerprint,
  ListChecks,
  WifiOff,
  Users,
  Radio,
  ShoppingBag,
  ArrowRight,
  Play,
} from "lucide-react";

/* ————————————————— count-up stat (IntersectionObserver + rAF) ————————————————— */

function useCountUp(target, duration = 1400) {
  const ref = useRef(null);
  const [value, setValue] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      setValue(target);
      return;
    }
    let raf = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduced || target === 0) {
          setValue(target);
          return;
        }
        const t0 = performance.now();
        const tick = (now) => {
          const p = Math.min(1, (now - t0) / duration);
          const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
          setValue(Math.round(target * eased));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [target, duration]);

  return [ref, value];
}

function StatCounter({ prefix = "", value, suffix = "", label, caption }) {
  const [ref, n] = useCountUp(value);
  return (
    <div ref={ref} className="text-center px-2">
      <p className="font-display font-mono-num text-4xl sm:text-5xl text-foreground tracking-tight">
        {prefix}
        {n}
        {suffix}
      </p>
      <p className="mt-1.5 text-sm font-semibold text-brand">{label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}

/* ————————————————— floating / tilting ID card mockup ————————————————— */

function TiltIdCard() {
  const tiltRef = useRef(null);

  const handleMove = (e) => {
    const el = tiltRef.current;
    if (!el) return;
    if (window.matchMedia("(pointer: coarse)").matches) return; // static on touch
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `rotateX(${(-py * 10).toFixed(2)}deg) rotateY(${(px * 12).toFixed(2)}deg)`;
  };

  const handleLeave = () => {
    if (tiltRef.current) tiltRef.current.style.transform = "";
  };

  return (
    <div
      className="mk-float"
      style={{ perspective: "900px" }}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      <div
        ref={tiltRef}
        className="mk-tilt w-[300px] sm:w-[340px] rounded-2xl border border-border bg-surface-2/90 backdrop-blur p-6 relative overflow-hidden"
        aria-hidden
      >
        <div
          className="absolute inset-x-0 top-0 h-1.5 bg-brand"
          style={{ background: "linear-gradient(90deg, hsl(var(--brand)), hsl(var(--brand-secondary)))" }}
        />
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-brand/15 border border-brand/40 flex items-center justify-center">
            <span className="font-display text-lg text-brand">JR</span>
          </div>
          <div>
            <p className="font-display text-lg text-foreground leading-tight">Juan Reyes</p>
            <p className="font-mono-num text-xs text-muted-foreground tracking-[0.14em] mt-0.5">
              60&apos;6&quot; ID · 606-2417
            </p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2">
          {[
            { k: "EXIT VELO", v: "78 mph" },
            { k: "60 YD", v: "7.42 s" },
            { k: "ARM", v: "72 mph" },
          ].map((s) => (
            <div key={s.k} className="rounded-lg bg-surface-3/80 border border-border px-2 py-2.5 text-center">
              <p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{s.k}</p>
              <p className="font-mono-num text-sm font-semibold text-foreground mt-0.5">{s.v}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Verified · 2026 Summer ID Camp</p>
          <span className="h-2 w-2 rounded-full bg-success inline-block" />
        </div>
      </div>
    </div>
  );
}

/* ————————————————— static content ————————————————— */

const STATS = [
  { prefix: "", value: 1, suffix: "", label: "permanent ID", caption: "One profile for an entire career" },
  { prefix: "", value: 12, suffix: "", label: "recap sections", caption: "In every AI development recap" },
  { prefix: "8–", value: 18, suffix: "", label: "age-matched forms", caption: "Evaluations tuned to each age group" },
  { prefix: "", value: 0, suffix: "", label: "duplicate profiles", caption: "Check-in matches athletes to their ID" },
];

const STEPS = [
  {
    icon: QrCode,
    title: "Register",
    text: "Families sign up from a shared link or event QR code — the athlete's permanent ID is created once.",
  },
  {
    icon: ClipboardCheck,
    title: "Check in",
    text: "On event day, athletes check in against their existing ID. No re-typing, no duplicates.",
  },
  {
    icon: MousePointerClick,
    title: "Evaluate",
    text: "Evaluators score live by tapping outcomes — a full station in about five taps.",
  },
  {
    icon: Sparkles,
    title: "AI recap",
    text: "Every athlete gets a 12-section development recap, reviewed and approved by an admin before release.",
  },
  {
    icon: TrendingUp,
    title: "Track development",
    text: "Season over season, every verified number lands on the same ID — the whole story in one place.",
  },
];

const FEATURES = [
  {
    icon: Fingerprint,
    title: "Permanent athlete ID",
    text: "One profile that follows the athlete across every camp, showcase and season — never rebuilt from scratch.",
  },
  {
    icon: ListChecks,
    title: "Age-matched evaluations",
    text: "Scoring forms tuned for ages 8–18, so a 10U athlete is never graded on a 17U rubric.",
  },
  {
    icon: WifiOff,
    title: "Offline-proof scoring",
    text: "Evaluators keep scoring when field Wi-Fi dies. Everything syncs the moment a connection returns.",
  },
  {
    icon: Sparkles,
    title: "AI development recaps",
    text: "Twelve sections of strengths, gaps and next steps — always admin-approved before a family sees it.",
  },
  {
    icon: Users,
    title: "Family portal",
    text: "Parents and athletes sign in to one clean portal: recaps, verified measurements and progress over time.",
  },
  {
    icon: Radio,
    title: "Live event control",
    text: "Run the whole day from one screen — stations, evaluator assignments and check-ins in real time.",
  },
];

/* ————————————————— landing store strip ————————————————— */

function StoreStripCard({ item }) {
  return (
    <a
      href={item.affiliate_url}
      target="_blank"
      rel="noopener sponsored"
      className="mk-card group rounded-xl border border-border bg-surface-2 overflow-hidden flex flex-col"
    >
      {item.image_url ? (
        <img src={item.image_url} alt={item.name} className="h-36 w-full object-cover" loading="lazy" />
      ) : (
        <div
          className="h-36 w-full flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, hsl(var(--brand) / 0.28), hsl(var(--surface-3)))" }}
        >
          <span className="font-display text-lg text-foreground/80">{item.category || "Gear"}</span>
        </div>
      )}
      <div className="p-4 flex flex-col flex-1">
        <p className="text-sm font-semibold text-foreground leading-snug">{item.name}</p>
        <div className="mt-auto pt-3 flex items-center justify-between">
          <span className="font-mono-num text-sm text-muted-foreground">{item.price_text || ""}</span>
          <span className="text-xs font-bold text-brand group-hover:translate-x-0.5 transition-transform">
            Shop →
          </span>
        </div>
      </div>
    </a>
  );
}

/* ————————————————— page ————————————————— */

export default function Landing() {
  const { user, loading } = useAuth();
  const revealRef = useReveal();
  const [storeItems, setStoreItems] = useState(null); // null = loading/failed, [] = empty

  useEffect(() => {
    let alive = true;
    api
      .get("/public/store")
      .then((r) => {
        if (alive) setStoreItems(Array.isArray(r.data?.items) ? r.data.items : []);
      })
      .catch(() => {
        if (alive) setStoreItems([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!loading && user) {
    // Staff enter through the role-based mode picker, never straight into a workspace.
    const home = user.role === "athlete" || user.role === "parent" ? "/my-id" : "/workspace";
    return <Navigate to={home} replace />;
  }

  const scrollToHow = () => {
    document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const featured = (storeItems || []).slice(0, 4);

  return (
    <div ref={revealRef} className="min-h-screen bg-background text-foreground" data-testid="landing-page">
      <PublicNav onLanding />

      {/* ————— Hero ————— */}
      <section className="relative overflow-hidden pt-28 sm:pt-36 pb-16 sm:pb-24">
        <div className="absolute inset-0 mk-hero-sweep" aria-hidden />
        <div className="relative max-w-6xl mx-auto px-5 sm:px-8 grid lg:grid-cols-[1.15fr_0.85fr] gap-12 items-center">
          <div>
            <p className="landing-fade-in inline-flex items-center gap-2 rounded-full border border-brand/40 bg-brand/10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
              Verified baseball evaluation platform
            </p>
            <h1 className="landing-rise landing-delay-1 mt-5 font-display text-[clamp(2.75rem,7.5vw,4.75rem)] leading-[1.02] tracking-[-0.035em] text-foreground">
              Every camp. Every rep.{" "}
              <span className="text-brand">One permanent ID.</span>
            </h1>
            <p className="landing-rise landing-delay-2 mt-5 text-base sm:text-lg text-muted-foreground max-w-xl leading-relaxed">
              60&apos;6&quot; ID gives every athlete one verified profile for life — live evaluations scored on the
              field, AI development recaps approved by coaches, and year-over-year growth families can actually see.
            </p>
            <div className="landing-rise landing-delay-3 mt-8 flex flex-col sm:flex-row gap-3">
              <Button
                asChild
                className="rounded-full h-14 px-8 text-base font-bold bg-brand hover:bg-brand-secondary text-primary-foreground"
              >
                <Link to="/signup" data-testid="landing-cta-signup">
                  Register your athlete
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
              <Button
                variant="outline"
                onClick={scrollToHow}
                className="rounded-full h-14 px-8 text-base font-semibold border-border bg-surface-2/40 text-foreground hover:bg-surface-3 hover:text-foreground"
                data-testid="landing-cta-how"
              >
                <Play className="mr-1 h-4 w-4 text-brand" />
                Watch how it works
              </Button>
            </div>
            <p className="landing-fade-in landing-delay-3 mt-4 text-xs text-muted-foreground">
              Staff, coaches, athletes &amp; guardians · Free for families
            </p>
          </div>

          <div className="hidden sm:flex justify-center lg:justify-end landing-fade-in landing-delay-2">
            <TiltIdCard />
          </div>
        </div>
      </section>

      {/* ————— Stats band ————— */}
      <section className="border-y border-border bg-surface-2/50">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-12 grid grid-cols-2 lg:grid-cols-4 gap-y-10">
          {STATS.map((s) => (
            <StatCounter key={s.label} {...s} />
          ))}
        </div>
      </section>

      {/* ————— How it works ————— */}
      <section id="how-it-works" className="scroll-mt-24 max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
        <div className="mk-reveal" data-reveal>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand">How it works</p>
          <h2 className="mt-2 font-display text-3xl sm:text-4xl tracking-tight text-foreground max-w-2xl">
            From sign-up to season-over-season story in five steps
          </h2>
        </div>

        {/* Desktop: horizontal timeline. Mobile: vertical rail. */}
        <div className="relative mt-12">
          <div
            className="hidden lg:block absolute left-0 right-0 top-6 h-px mk-timeline-line"
            aria-hidden
          />
          <ol className="grid lg:grid-cols-5 gap-8 lg:gap-5 relative">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              return (
                <li
                  key={step.title}
                  className="mk-reveal relative flex lg:block gap-4"
                  data-reveal
                  style={{ transitionDelay: `${i * 90}ms` }}
                >
                  {/* mobile vertical connector */}
                  {i < STEPS.length - 1 && (
                    <span
                      className="lg:hidden absolute left-6 top-12 bottom-[-2rem] w-px bg-border"
                      aria-hidden
                    />
                  )}
                  <div className="relative z-10 h-12 w-12 shrink-0 rounded-full border border-brand/50 bg-background flex items-center justify-center">
                    <Icon className="h-5 w-5 text-brand" />
                  </div>
                  <div className="lg:mt-5">
                    <p className="text-[11px] font-mono-num text-muted-foreground">Step {i + 1}</p>
                    <h3 className="font-display text-lg text-foreground mt-0.5">{step.title}</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{step.text}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* ————— Feature grid ————— */}
      <section id="features" className="scroll-mt-24 border-t border-border bg-surface-2/30">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
          <div className="mk-reveal" data-reveal>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand">Features</p>
            <h2 className="mt-2 font-display text-3xl sm:text-4xl tracking-tight text-foreground max-w-2xl">
              Built for the field, trusted by families
            </h2>
          </div>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="mk-reveal mk-card rounded-xl border border-border bg-surface-2 p-6"
                  data-reveal
                  style={{ transitionDelay: `${(i % 3) * 80}ms` }}
                >
                  <div className="h-11 w-11 rounded-lg bg-brand/10 border border-brand/30 flex items-center justify-center">
                    <Icon className="h-5 w-5 text-brand" />
                  </div>
                  <h3 className="mt-4 font-display text-lg text-foreground">{f.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ————— Store strip ————— */}
      <section id="store" className="scroll-mt-24 max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-24">
        <div className="mk-reveal flex flex-col sm:flex-row sm:items-end justify-between gap-4" data-reveal>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand">The 60&apos;6&quot; Locker</p>
            <h2 className="mt-2 font-display text-3xl sm:text-4xl tracking-tight text-foreground">Gear we trust</h2>
            <p className="mt-2 text-sm text-muted-foreground max-w-lg">
              Hand-picked bats, gloves and training gear — every purchase goes through our trusted partner links.
            </p>
          </div>
          <Button
            asChild
            variant="outline"
            className="rounded-full h-11 px-6 font-semibold border-border bg-surface-2/40 text-foreground hover:bg-surface-3 hover:text-foreground shrink-0"
          >
            <Link to="/store" data-testid="landing-store-link">
              <ShoppingBag className="mr-1.5 h-4 w-4 text-brand" />
              Visit the store
            </Link>
          </Button>
        </div>

        <div className="mk-reveal mt-8" data-reveal>
          {featured.length > 0 ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {featured.map((item) => (
                <StoreStripCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-surface-2/50 p-10 text-center">
              <ShoppingBag className="h-8 w-8 text-brand mx-auto" />
              <p className="mt-3 font-display text-lg text-foreground">Store opening soon</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The gear our coaches actually use is on its way. Check back shortly.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ————— For clubs ————— */}
      <section id="for-clubs" className="scroll-mt-24 max-w-6xl mx-auto px-5 sm:px-8 pb-20 sm:pb-28">
        <div
          className="mk-reveal rounded-2xl border border-brand/30 p-8 sm:p-12 relative overflow-hidden"
          data-reveal
          style={{
            background:
              "radial-gradient(ellipse 80% 90% at 15% 0%, hsl(var(--brand) / 0.18), transparent 60%), hsl(var(--surface-2))",
          }}
        >
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand">For clubs &amp; programs</p>
          <h2 className="mt-2 font-display text-3xl sm:text-4xl tracking-tight text-foreground max-w-xl">
            Run your whole evaluation day on 60&apos;6&quot; ID
          </h2>
          <ul className="mt-6 space-y-3 max-w-xl">
            {[
              "Registration links and QR check-in — no clipboards, no duplicate athletes",
              "Evaluator scoring in about five taps per station, even with no Wi-Fi",
              "AI development recaps delivered to every family, admin-approved first",
            ].map((b) => (
              <li key={b} className="flex items-start gap-3 text-sm sm:text-base text-muted-foreground">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-brand shrink-0" />
                {b}
              </li>
            ))}
          </ul>
          <Button
            asChild
            className="mt-8 rounded-full h-12 px-7 font-bold bg-brand hover:bg-brand-secondary text-primary-foreground"
          >
            <a href="mailto:pbgmidwest@philippines-baseball.org" data-testid="landing-clubs-cta">
              Talk to us
            </a>
          </Button>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
