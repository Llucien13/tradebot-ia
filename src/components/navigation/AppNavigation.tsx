import { Link, useLocation } from "react-router-dom";
import { Cable, History, LayoutDashboard, Settings } from "lucide-react";
import { RELEASE } from "@/release";

const items = [
  { to: "/", label: `Monitoring PRO ${RELEASE}`, short: RELEASE, icon: LayoutDashboard },
  { to: "/v85", label: "Espace V85 / FTMO 20 000 €", short: "V85", icon: LayoutDashboard },
  { to: "/mt5", label: "Connexion MT5", short: "MT5", icon: Cable },
  { to: "/historique", label: "Historique et performances", short: "Historique", icon: History },
  { to: "/settings", label: "Paramètres", short: "Paramètres", icon: Settings },
];

export function AppNavigation({ mobile = false }: { mobile?: boolean }) {
  const { pathname } = useLocation();
  return <div className={mobile ? "flex w-full gap-1 pb-[env(safe-area-inset-bottom)]" : "space-y-2"}>
    {items.map(item => <Link key={item.to} to={item.to} aria-label={item.label} aria-current={pathname === item.to ? "page" : undefined}
      className={`${mobile ? "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px]" : "flex min-h-12 items-center gap-3 px-3 py-3 text-sm"} rounded-xl font-medium transition-colors ${pathname === item.to ? "bg-primary/15 text-primary ring-1 ring-primary/20" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
      <item.icon className={`${mobile ? "h-5 w-5" : "h-4 w-4"} shrink-0`} />
      <span>{mobile ? item.short : item.label}</span>
    </Link>)}
  </div>;
}
