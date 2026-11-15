import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
const tones = {
  good: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  warning: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  error: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  info: "border-primary/30 bg-primary/10 text-primary",
  muted: "border-border bg-secondary/40 text-muted-foreground",
};
export function TradingStateBadge({ children, tone = "info", className }: { children: React.ReactNode; tone?: keyof typeof tones; className?: string }) {
  return <Badge variant="outline" className={cn("rounded-lg px-2.5 py-1 text-[11px] font-semibold hover:bg-transparent", tones[tone], className)}>{children}</Badge>;
}
