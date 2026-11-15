import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: "ACTIVE" | "PAUSED" | "ERROR" | "OFFLINE";
  className?: string;
}

export const StatusBadge = ({ status, className }: StatusBadgeProps) => {
  const config = {
    ACTIVE: { label: "Actif", className: "status-active" },
    PAUSED: { label: "En pause", className: "status-paused" },
    ERROR: { label: "Erreur", className: "status-error" },
    OFFLINE: { label: "Indisponible", className: "status-offline" },
  };

  const { label, className: statusClass } = config[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-medium",
        statusClass,
        className
      )}
    >
      <span className="status-dot bg-current"></span>
      {label}
    </span>
  );
};