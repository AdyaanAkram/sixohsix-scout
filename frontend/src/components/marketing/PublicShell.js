import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

/* ————— shared marketing chrome for the public pages (/ and /store) ————— */

export function Wordmark({ small = false }) {
  return (
    <Link to="/" className="inline-block leading-none" aria-label="60'6&quot; ID home">
      <p className={`font-display tracking-tight text-foreground ${small ? "text-xl" : "text-2xl sm:text-3xl"}`}>
        60&apos;6&quot; <span className="text-brand">ID</span>
      </p>
      <p className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground mt-0.5">
        Train. Elevate. Succeed.
      </p>
    </Link>
  );
}

const NAV_LINKS = [
  { label: "How it works", hash: "#how-it-works" },
  { label: "Features", hash: "#features" },
  { label: "Store", hash: "#store", to: "/store" },
  { label: "For Clubs", hash: "#for-clubs" },
];

export function PublicNav({ onLanding = false }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 border-b transition-colors duration-300 ${
        scrolled ? "glass-bar border-border" : "border-transparent bg-transparent"
      }`}
    >
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 px-5 sm:px-8 h-16 sm:h-[72px]">
        <Wordmark small />

        <nav className="hidden md:flex items-center gap-7" aria-label="Site">
          {NAV_LINKS.map((l) =>
            onLanding || !l.to ? (
              <a
                key={l.label}
                href={onLanding ? l.hash : `/${l.hash}`}
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {l.label}
              </a>
            ) : (
              <Link
                key={l.label}
                to={l.to}
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {l.label}
              </Link>
            )
          )}
        </nav>

        <div className="flex items-center gap-2">
          <Button
            asChild
            variant="outline"
            className="rounded-full h-10 px-4 sm:px-5 border-border bg-surface-2/40 text-foreground hover:bg-surface-3 hover:text-foreground"
          >
            <Link to="/signin" data-testid="landing-signin-link">Sign in</Link>
          </Button>
          <Button
            asChild
            className="rounded-full h-10 px-4 sm:px-5 font-bold bg-brand hover:bg-brand-secondary text-primary-foreground"
          >
            <Link to="/signup" data-testid="landing-nav-signup">
              <span className="hidden sm:inline">Get your athlete&apos;s ID</span>
              <span className="sm:hidden">Get an ID</span>
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 py-12">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-8">
          <div>
            <Wordmark />
            <p className="mt-3 text-xs uppercase tracking-[0.22em] text-brand font-semibold">
              Train. Elevate. Succeed.
            </p>
          </div>
          <nav className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm" aria-label="Footer">
            <Link to="/signin" className="text-muted-foreground hover:text-foreground transition-colors">Sign in</Link>
            <Link to="/signup" className="text-muted-foreground hover:text-foreground transition-colors">Register</Link>
            <Link to="/store" className="text-muted-foreground hover:text-foreground transition-colors">Store</Link>
            <a href="/guide" className="text-muted-foreground hover:text-foreground transition-colors">Guide</a>
          </nav>
        </div>
        <p className="mt-10 text-[11px] text-muted-foreground/70 leading-relaxed max-w-2xl">
          © {new Date().getFullYear()} 60&apos;6&quot; ID. One permanent athlete profile for every camp, showcase and
          season. Store purchases are completed on our partners&apos; sites through affiliate links.
        </p>
      </div>
    </footer>
  );
}

/* ————— scroll-reveal: observe children tagged data-reveal, add .is-visible ————— */
export function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const targets = root.querySelectorAll("[data-reveal]");
    if (!("IntersectionObserver" in window)) {
      targets.forEach((t) => t.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);
  return ref;
}
