import { Link, useLocation } from "react-router-dom";
import { Activity, BarChart3, Bell, BookOpen, Bot, Globe, History, LayoutDashboard, Menu, Settings, ShieldCheck, TrendingUp, Zap } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const items = [
  { to: "/", label: "Accueil", icon: LayoutDashboard },
  { to: "/scalping", label: "Scalping M1", icon: Zap },
  { to: "/scalping-m5", label: "Scalping M5", icon: BarChart3 },
  { to: "/strategy-h1", label: "Stratégie H1", icon: Settings },
  { to: "/historique", label: "Historique", icon: BookOpen },
  { to: "/settings", label: "Paramètres", icon: Settings },
  { to: "/ftmo-20k", label: "FTMO 20K", icon: ShieldCheck },
];

export function AppNavigation({ mobile = false }: { mobile?: boolean }) {
  const { pathname } = useLocation();
  const links = items.map((item) => (
    <div key={item.to}>
      <Link
        to={item.to}
        aria-current={pathname === item.to ? "page" : undefined}
        className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium ${
          pathname === item.to
            ? "bg-primary/15 text-primary ring-1 ring-primary/20"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
        }`}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {item.label}
      </Link>
    </div>
  ));

  if (!mobile) return <div className="space-y-1">{links}</div>;
  return (
    <div className="flex w-full items-center justify-around gap-1 pb-[env(safe-area-inset-bottom)]">
      {items.slice(0, 4).map((item) => (
        <Link
          key={item.to}
          to={item.to}
          aria-current={pathname === item.to ? "page" : undefined}
          className={`flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] ${
            pathname === item.to ? "bg-primary/15 text-primary" : "text-muted-foreground"
          }`}
        >
          <item.icon className="h-5 w-5" />
          <span>{item.to === "/" ? "Accueil" : item.label}</span>
        </Link>
      ))}
      <Sheet>
        <SheetTrigger
          aria-label="Ouvrir le menu de navigation"
          className={`flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] ${
            items.slice(4).some((item) => item.to === pathname) ? "bg-primary/15 text-primary" : "text-muted-foreground"
          }`}
        >
          <Menu className="h-5 w-5" />
          Menu
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-3xl border-primary/20 bg-card pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <SheetHeader className="mb-4 text-left">
            <SheetTitle>TradeBot IA · Navigation</SheetTitle>
          </SheetHeader>
          <div className="grid gap-1 sm:grid-cols-2">
            {items.map((item) => (
              <SheetClose key={item.to} asChild>
                <Link
                  to={item.to}
                  aria-current={pathname === item.to ? "page" : undefined}
                  className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm ${
                    pathname === item.to ? "bg-primary/15 font-semibold text-primary" : "text-foreground hover:bg-secondary"
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              </SheetClose>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}