"use client";

import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/cn";

export const Dropdown = DropdownPrimitive.Root;
export const DropdownTrigger = DropdownPrimitive.Trigger;

export function DropdownContent({
  className,
  sideOffset = 4,
  ...props
}: DropdownPrimitive.DropdownMenuContentProps) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[12rem] overflow-hidden rounded-xl bg-white border border-slate-200 p-1.5 shadow-lg shadow-slate-200/60",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          "data-[side=bottom]:slide-in-from-top-2",
          "data-[side=top]:slide-in-from-bottom-2",
          className
        )}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownItem({
  className,
  ...props
}: DropdownPrimitive.DropdownMenuItemProps) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        "relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-slate-600 outline-none select-none",
        "data-[highlighted]:bg-slate-50 data-[highlighted]:text-slate-900",
        "cursor-pointer transition-colors",
        className
      )}
      {...props}
    />
  );
}

export function DropdownCheckboxItem({
  className,
  children,
  ...props
}: DropdownPrimitive.DropdownMenuCheckboxItemProps) {
  return (
    <DropdownPrimitive.CheckboxItem
      className={cn(
        "relative flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-600 outline-none select-none",
        "data-[highlighted]:bg-slate-50 data-[highlighted]:text-slate-900",
        "cursor-pointer transition-colors",
        className
      )}
      {...props}
    >
      <DropdownPrimitive.ItemIndicator>
        <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </DropdownPrimitive.ItemIndicator>
      <span className={cn(!props.checked && "ml-5")}>{children}</span>
    </DropdownPrimitive.CheckboxItem>
  );
}

export function DropdownLabel({
  className,
  ...props
}: DropdownPrimitive.DropdownMenuLabelProps) {
  return (
    <DropdownPrimitive.Label
      className={cn("px-2.5 py-1.5 text-xs font-semibold text-slate-400", className)}
      {...props}
    />
  );
}

export function DropdownSeparator({
  className,
  ...props
}: DropdownPrimitive.DropdownMenuSeparatorProps) {
  return (
    <DropdownPrimitive.Separator
      className={cn("my-1 h-px bg-slate-100", className)}
      {...props}
    />
  );
}
