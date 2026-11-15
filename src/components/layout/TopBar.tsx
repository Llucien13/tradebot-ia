import { useState } from "react";
import {
  Bell,
  Search,
  User,
  Paperclip,
  Settings,
  Moon,
  Sun,
  Wifi,
  WifiOff,
} from "lucide-react";

export const TopBar = () => {
  const [darkMode, setDarkMode] = useState(true);

  return (
    <header className="h-16 border-b border-border flex items-center justify-between px-4 bg-card/50 backdrop-blur-sm">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary/20 rounded flex items-center justify-center">
            <Paperclip className="h-5 w-5 text-primary" />
          </div>
          <span className="text-xl font-bold text-primary">TradeBot IA</span>
        </div>
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary border border-border">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Rechercher..."
            className="bg-transparent border-none outline-none text-sm w-48"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Wifi className="h-4 w-4 text-success" />
          <span className="hidden sm:inline">Paper Trading</span>
        </div>
        <button
          onClick={() => setDarkMode(!darkMode)}
          className="p-2 rounded-lg hover:bg-secondary transition-colors"
          aria-label="Changer le thème"
        >
          {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button className="p-2 rounded-lg hover:bg-secondary transition-colors relative" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-destructive rounded-full"></span>
        </button>
        <button className="p-2 rounded-lg hover:bg-secondary transition-colors" aria-label="Paramètres">
          <Settings className="h-4 w-4" />
        </button>
        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
          <User className="h-4 w-4 text-primary" />
        </div>
      </div>
    </header>
  );
};