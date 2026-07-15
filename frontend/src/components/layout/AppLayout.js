import { useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
  LayoutDashboard, CalendarDays, Users, ClipboardList, BarChart3, TrendingUp,
  UserCog, FileSpreadsheet, Settings, LogOut, Menu, Home, ClipboardCheck,
  MoreHorizontal, ScrollText, ShieldCheck, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const NAV_BY_ROLE = {
  owner: ["dashboard", "events", "players", "review", "reports", "development", "staff", "templates", "audit", "settings"],
  admin: ["dashboard", "events", "players", "review", "reports", "development", "staff", "templates", "audit", "settings"],
  head_scout: ["dashboard", "events", "players", "review", "reports", "development", "settings"],
  coach: ["dashboard", "events", "players", "development", "reports", "settings"],
  evaluator: ["dashboard", "events", "evaluate", "my-evaluations", "settings"],
};

const NAV_ITEMS = {
  dashboard: { to: "/", label: "Dashboard", icon: LayoutDashboard },
  events: { to: "/events", label: "Evaluation Events", icon: CalendarDays },
  players: { to: "/players", label: "Players", icon: Users },
  evaluate: { to: "/evaluate", label: "Evaluate", icon: ClipboardCheck },
  "my-evaluations": { to: "/my-evaluations", label: "My Evaluations", icon: ClipboardList },
  review: { to: "/review", label: "Evaluations", icon: ClipboardList },
  reports: { to: "/reports", label: "Reports", icon: BarChart3 },
  development: { to: "/development", label: "Development", icon: TrendingUp },
  staff: { to: "/staff", label: "Staff", icon: UserCog },
  templates: { to: "/templates", label: "Templates", icon: FileSpreadsheet },
  audit: { to: "/audit-log", label: "Audit Log", icon: ScrollText },
  settings: { to: "/settings", label: "Settings", icon: Settings },
};

const ROLE_LABELS = {
  owner: "Organization Owner", admin: "Administrator", head_scout: "Head Scout",
  coach: "Coach", evaluator: "Evaluator",
};

const Logo = ({ compact }) => (
  <div className="flex items-center gap-2.5">
    <div className="h-9 w-9 rounded-xl bg-[#0B1E3A] flex items-center justify-center ring-1 ring-[#F4B400]/50">
      <ShieldCheck className="h-5 w-5 text-[#F4B400]" />
    </div>
    {!compact && (
      <div className="leading-none">
        <p className="font-display text-xl text-[#0B1E3A]">PBG SCOUT</p>
        <p className="text-[10px] text-slate-500 tracking-wide uppercase">PBG Midwest</p>
      </div>
    )}
  </div>
);

const SidebarLink = ({ item, onClick }) => {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      onClick={onClick}
      data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150",
          isActive
            ? "bg-[#0B1E3A] text-white"
            : "text-slate-600 hover:bg-[hsl(var(--secondary))] hover:text-[#0B1E3A]"
        )
      }
    >
      <Icon className="h-[18px] w-[18px]" />
      {item.label}
    </NavLink>
  );
};

const MOBILE_PRIMARY = {
  owner: ["dashboard", "events", "players", "review"],
  admin: ["dashboard", "events", "players", "review"],
  head_scout: ["dashboard", "events", "players", "review"],
  coach: ["dashboard", "events", "players", "development"],
  evaluator: ["dashboard", "events", "evaluate", "my-evaluations"],
};

const MOBILE_LABELS = { dashboard: "Home", events: "Events", players: "Players", review: "Evaluate", evaluate: "Evaluate", development: "Develop", "my-evaluations": "My Evals" };
const MOBILE_ICONS = { dashboard: Home, events: CalendarDays, players: Users, review: ClipboardList, evaluate: ClipboardCheck, development: TrendingUp, "my-evaluations": ClipboardList };

export const AppLayout = ({ children }) => {
  const { user, logout } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const role = user?.role || "evaluator";
  const navKeys = NAV_BY_ROLE[role] || NAV_BY_ROLE.evaluator;
  const mobileKeys = MOBILE_PRIMARY[role] || MOBILE_PRIMARY.evaluator;
  const moreKeys = navKeys.filter((k) => !mobileKeys.includes(k));

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-[268px] flex-col border-r bg-white z-40" data-testid="desktop-sidebar-nav">
        <div className="px-5 py-5 border-b">
          <Logo />
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navKeys.map((k) => (
            <SidebarLink key={k} item={NAV_ITEMS[k]} />
          ))}
        </nav>
        <div className="border-t px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#0B1E3A] truncate" data-testid="sidebar-user-name">{user?.full_name}</p>
              <p className="text-xs text-slate-500">{ROLE_LABELS[role]}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={logout} data-testid="logout-button" title="Sign out">
              <LogOut className="h-4 w-4 text-slate-500" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-40 bg-white/95 backdrop-blur border-b">
        <div className="flex items-center justify-between px-4 h-14">
          <Logo />
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-500 mr-1">{ROLE_LABELS[role]}</span>
            <Button variant="ghost" size="icon" onClick={logout} data-testid="mobile-logout-button">
              <LogOut className="h-4 w-4 text-slate-500" />
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="lg:pl-[268px]">
        <div className="mx-auto max-w-[1200px] px-4 sm:px-6 py-5 sm:py-7 pb-safe-nav lg:pb-10">
          {children}
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t bg-white/95 backdrop-blur sticky-bar-shadow"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        data-testid="mobile-bottom-nav"
      >
        <div className="grid grid-cols-5">
          {mobileKeys.map((k) => {
            const item = NAV_ITEMS[k];
            const Icon = MOBILE_ICONS[k] || item.icon;
            const active = item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={k}
                to={item.to}
                data-testid={`mobile-bottom-nav-${MOBILE_LABELS[k].toLowerCase().replace(/\s+/g, "-")}`}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 py-2.5 min-h-[60px] text-[11px] font-medium transition-colors",
                  active ? "text-[#0B1E3A]" : "text-slate-400"
                )}
              >
                <Icon className={cn("h-5 w-5", active && "stroke-[2.4]")} />
                {MOBILE_LABELS[k]}
              </NavLink>
            );
          })}
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger asChild>
              <button
                data-testid="mobile-bottom-nav-more"
                className="flex flex-col items-center justify-center gap-0.5 py-2.5 min-h-[60px] text-[11px] font-medium text-slate-400"
              >
                <MoreHorizontal className="h-5 w-5" />
                More
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-2xl pb-8">
              <p className="font-display text-2xl text-[#0B1E3A] mb-3">More</p>
              <div className="grid grid-cols-2 gap-2">
                {moreKeys.map((k) => {
                  const item = NAV_ITEMS[k];
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={k}
                      to={item.to}
                      onClick={() => setMoreOpen(false)}
                      data-testid={`more-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                      className="flex items-center gap-3 rounded-xl border bg-white px-4 py-3.5 text-sm font-medium text-slate-700 active:scale-[0.98] transition"
                    >
                      <Icon className="h-5 w-5 text-[#0B1E3A]" />
                      {item.label}
                    </NavLink>
                  );
                })}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </div>
  );
};
