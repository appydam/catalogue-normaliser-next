"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Icon } from "./ui/icon";
import { cn } from "@/lib/cn";
import type { IconName } from "@/lib/constants";

const NAV_ITEMS: { href: string; label: string; icon: IconName; matchExact?: boolean }[] = [
  { href: "/", label: "Catalogs", icon: "catalog", matchExact: true },
  { href: "/upload", label: "Upload Catalog", icon: "upload" },
  { href: "/search", label: "Search Products", icon: "search" },
  { href: "/quotations", label: "Quick Quotation", icon: "receipt" },
  { href: "/procurement", label: "Procurement", icon: "procurement" },
  { href: "/schemes", label: "Scheme Tracker", icon: "scheme" },
  { href: "/insights", label: "Demand Intelligence", icon: "insights" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  }

  const nav = (
    <>
      {/* Brand */}
      <div className="px-5 py-5 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <Image
            src="/logo.svg"
            alt="CatalogAI logo"
            width={32}
            height={32}
            className="shrink-0"
          />
          <div>
            <h1 className="text-sm font-bold text-slate-900 leading-none tracking-tight">CatalogAI</h1>
            <p className="text-[11px] text-slate-400 mt-0.5">AI-Powered Extraction</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map(({ href, label, icon, matchExact }) => {
          const active = isActive(href, matchExact);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group",
                active
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              )}
            >
              <Icon
                name={icon}
                className={cn(
                  "w-[18px] h-[18px] transition-colors",
                  active ? "text-indigo-500" : "text-slate-400 group-hover:text-slate-500"
                )}
              />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-slate-100">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] text-slate-400">Powered by Claude AI</span>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-lg bg-white border border-slate-200 shadow-sm"
        aria-label="Open navigation"
      >
        <Icon name="menu" className="w-5 h-5 text-slate-600" strokeWidth={2} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative w-64 h-full bg-white flex flex-col shadow-xl">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-3 right-3 p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              aria-label="Close navigation"
            >
              <Icon name="x" className="w-4 h-4" strokeWidth={2} />
            </button>
            {nav}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 bg-white border-r border-slate-200 flex-col">
        {nav}
      </aside>
    </>
  );
}
