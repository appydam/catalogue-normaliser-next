import { STATUS_CONFIG, type StatusKey } from "@/lib/constants";
import { cn } from "@/lib/cn";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const cfg = STATUS_CONFIG[status as StatusKey] ?? STATUS_CONFIG.pending;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset",
        cfg.badgeClass,
        className
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.dotClass)} />
      {cfg.label}
    </span>
  );
}
