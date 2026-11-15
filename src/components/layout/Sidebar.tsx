import { NavLink, useLocation } from "react-router-dom";
import { Zap, Settings, LayoutDashboard, Book, Activity } from "lucide-react";

interface SidebarProps {
  location: string;
}

export const Sidebar = ({ location }: SidebarProps) => {
  const isActive = (path: string) => location === path;

  const navItems = [
    { to: "/", icon: LayoutDashboard, label: "Accueil" },
    { to: "/scalping", icon: Zap, label: "Scalping M1" },
    { to: "/strategy-h1", icon: Settings, label: "Stratégie H1" },
    { to: "/historique", icon: Book, label: "Historique" },
    { to: "/settings", icon: Activity, label: "Paramètres" },
  ];

  return (
    <aside className="w-64 bg-sidebar border-r border-border flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary/20 rounded flex items-center justify-center">
            <Settings className="h-5 w-5 text-primary" />
          </div>
          <span className="text-xl font-bold text-primary">TradeBot IA</span>
        </div>
        <button className="p-1 text-muted-foreground hover:text-foreground">
          <div className="w-6 h-6">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-6 h-6"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto">
        <ul className="space-y-1 px-2">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} className={({ isActive: active }) => `nav-item ${active ? "active" : ""}`}>
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-border p-4">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="w-3 h-3 rounded-full bg-success"></div>
          <span>Paper Trading</span>
        </div>
        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
          <div className="w-3 h-3 rounded-full bg-primary/20"></div>
          <span>v1.0.0</span>
        </div>
      </div>
    </aside>
  );
};