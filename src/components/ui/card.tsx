import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
}

export function Card({ className, hover, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "bg-white rounded-xl border border-slate-200 transition-all duration-200",
        hover && "hover:shadow-md hover:shadow-slate-200/60 hover:border-slate-300 cursor-pointer",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4 border-b border-slate-100", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}
