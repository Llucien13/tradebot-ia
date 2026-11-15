import { useState } from "react";
import {
  Menu,
  X,
  LayoutDashboard,
  Zap,
  Settings,
  Book,
  Activity,
} from "lucide-react";

export const MobileNav = () => {
  const [open, setOpen] = useState(false);

  const links = [
    { to: "/", icon: LayoutDashboard, label: "Accueil" },
    { to: "/scalping", icon: Zap, label: "Scalping M1" },
    { to: "/strategy-h1", icon: Settings, label: "Stratégie H1" },
    { to: "/historique", icon: Book, label: "Historique" },
    { to: "/settings", icon: Activity, label: "Paramètres" },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm">
      <nav className="fixed right-0 top-0 w-64 h-full bg-sidebar border-l border-border transform translate-x-full transition-transform duration-300" aria-label="Menu principal">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-3">
            <Settings className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold text-primary">TradeBot IA</span>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1 text-muted-foreground hover:text-foreground"
            aria-label="Fermer le menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <ul className="flex-1 py-2 space-y-1">
          {links.map((link) => (
            <li key={link.to} className="flex items-center gap-3 px-2 py-2 rounded-lg text-sm hover:bg-sidebar-accent transition-colors">
              <link.icon className="h-4 w-4" />
              <span>{link.label}</span>
            </li>
          ))}
        </ul>
      </nav>

      <button
        onClick={() => setOpen(true)}
        className="fixed left-4 top-4 z-50"
        aria-label="Ouvrir le menu"
      >
        <Menu className="h-6 w-6 text-primary" />
      </button>
    </div>
  );
};