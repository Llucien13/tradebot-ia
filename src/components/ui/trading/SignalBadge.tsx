import { cn } from "@/lib/utils";

interface SignalBadgeProps {
  signal: "BUY" | "SELL" | "WAIT";
  className?: string;
}

export const SignalBadge = ({ signal, className }: SignalBadgeProps) => {
  const config = {
    BUY: { label: "BUY", className: "signal-buy" },
    SELL: { label: "SELL", className: "signal-sell" },
    WAIT: { label: "WAIT", className: "signal-wait" },
  };

  const { label, className: signalClass } = config[signal];

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium",
        signalClass,
        className
      )}
    >
      {label}
    </span>
  );
};