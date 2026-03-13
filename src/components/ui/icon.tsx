import { ICONS, type IconName } from "@/lib/constants";
import { cn } from "@/lib/cn";

interface IconProps {
  name: IconName;
  className?: string;
  strokeWidth?: number;
}

export function Icon({ name, className, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg
      className={cn("shrink-0", className)}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={strokeWidth}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={ICONS[name]} />
    </svg>
  );
}
