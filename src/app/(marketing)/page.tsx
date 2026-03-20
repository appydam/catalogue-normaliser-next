"use client";

import Image from "next/image";
import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      {/* ─── Navigation Bar ─── */}
      <nav className="glass sticky top-0 z-50 border-b border-white/20">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.svg" alt="CatalogAI" width={28} height={28} />
            <span className="text-lg font-bold tracking-tight">CatalogAI</span>
          </Link>

          <div className="flex items-center gap-2 sm:gap-6">
            <a
              href="#features"
              className="hidden text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 sm:inline-block"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="hidden text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 sm:inline-block"
            >
              How It Works
            </a>
            <Link
              href="/sign-in"
              className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
            >
              Sign In
            </Link>
            <Link
              href="/sign-up"
              className="btn-skeu rounded-lg px-4 py-2 text-sm font-semibold text-white"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* ─── Hero Section ─── */}
      <section className="paper-texture relative overflow-hidden">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 md:grid-cols-2 md:py-28 lg:px-8">
          {/* Left — Copy */}
          <div className="animate-fade-in-up max-w-xl">
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              Turn Supplier Catalogs Into
              <br />
              <span className="gradient-text">Business Intelligence</span>
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-slate-600">
              Upload any PDF catalog and let AI extract every product, price, and
              specification in minutes — not days. Search across brands in plain
              English, compare prices, and generate quotations instantly.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/sign-up"
                className="btn-skeu rounded-xl px-6 py-3 text-base font-semibold text-white"
              >
                Start Extracting — Free
              </Link>
              <Link
                href="/dashboard"
                className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
              >
                Explore Dashboard
              </Link>
            </div>
          </div>

          {/* Right — Hero Visual */}
          <div className="animate-fade-in stagger-2 relative flex items-center justify-center">
            {/* Floating badges */}
            <div
              className="animate-float absolute -top-2 left-4 z-10 rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-600 shadow-lg md:left-0"
              style={{ animationDelay: "0s" }}
            >
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-indigo-500" />
              AI-Powered
            </div>
            <div
              className="animate-float absolute -right-2 top-12 z-10 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-600 shadow-lg md:right-0"
              style={{ animationDelay: "0.6s" }}
            >
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              99% Accuracy
            </div>
            <div
              className="animate-float absolute -bottom-2 left-8 z-10 rounded-full border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-600 shadow-lg md:left-4"
              style={{ animationDelay: "1.2s" }}
            >
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-violet-500" />
              10x Faster
            </div>

            {/* Document illustration */}
            <div
              className="relative h-72 w-56 rounded-xl bg-white shadow-2xl sm:h-80 sm:w-64"
              style={{ transform: "rotate(3deg)" }}
            >
              {/* Scan line */}
              <div
                className="pointer-events-none absolute left-0 z-20 h-0.5 w-full bg-indigo-400"
                style={{
                  animation: "scanLine 2.5s ease-in-out infinite",
                  boxShadow: "0 0 8px 2px rgba(99,102,241,0.4)",
                }}
              />
              {/* Document header */}
              <div className="rounded-t-xl bg-gradient-to-r from-indigo-50 to-violet-50 px-4 py-3">
                <div className="h-2 w-20 rounded bg-indigo-200" />
                <div className="mt-1.5 h-1.5 w-32 rounded bg-indigo-100" />
              </div>
              {/* Fake table rows */}
              <div className="space-y-2.5 px-4 py-3">
                {[
                  ["w-10", "w-16", "w-8"],
                  ["w-12", "w-14", "w-6"],
                  ["w-8", "w-18", "w-10"],
                  ["w-14", "w-12", "w-7"],
                  ["w-10", "w-16", "w-9"],
                  ["w-11", "w-14", "w-6"],
                  ["w-9", "w-18", "w-8"],
                ].map((cols, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className={`h-1.5 ${cols[0]} rounded bg-slate-200`} />
                    <div className={`h-1.5 ${cols[1]} rounded bg-slate-100`} />
                    <div className={`h-1.5 ${cols[2]} rounded bg-slate-150 bg-slate-100`} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section id="how-it-works" className="bg-slate-50/60 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="animate-fade-in-up text-center text-3xl font-extrabold tracking-tight sm:text-4xl">
            How It <span className="gradient-text">Works</span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-slate-500">
            Three simple steps to transform raw catalog PDFs into structured,
            searchable product data.
          </p>

          <div className="mt-14 grid gap-8 md:grid-cols-3">
            {/* Step 1 */}
            <div className="animate-fade-in-up stagger-1 card-inset relative rounded-2xl p-6 text-center">
              <div className="metal-circle mx-auto flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold text-slate-700">
                1
              </div>
              <div className="mx-auto mt-4 flex h-12 w-12 items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-500">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <line x1="9" y1="15" x2="15" y2="15" />
                </svg>
              </div>
              <h3 className="mt-3 text-lg font-bold">Upload PDF Catalog</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Drag and drop any supplier catalog PDF. We handle multi-page
                documents with complex layouts.
              </p>
              {/* Arrow */}
              <div className="absolute -right-5 top-1/2 hidden -translate-y-1/2 text-2xl text-slate-300 md:block">
                →
              </div>
            </div>

            {/* Step 2 */}
            <div className="animate-fade-in-up stagger-2 card-inset relative rounded-2xl p-6 text-center">
              <div className="metal-circle mx-auto flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold text-slate-700">
                2
              </div>
              <div className="mx-auto mt-4 flex h-12 w-12 items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-500">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                  <path d="M8 12h8" />
                </svg>
              </div>
              <h3 className="mt-3 text-lg font-bold">AI Extracts Every Product</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Claude AI reads each page, identifying products, prices,
                specifications, and catalog numbers with remarkable accuracy.
              </p>
              {/* Arrow */}
              <div className="absolute -right-5 top-1/2 hidden -translate-y-1/2 text-2xl text-slate-300 md:block">
                →
              </div>
            </div>

            {/* Step 3 */}
            <div className="animate-fade-in-up stagger-3 card-inset rounded-2xl p-6 text-center">
              <div className="metal-circle mx-auto flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold text-slate-700">
                3
              </div>
              <div className="mx-auto mt-4 flex h-12 w-12 items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-500">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <h3 className="mt-3 text-lg font-bold">Search &amp; Compare Across Brands</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Use natural language to search, filter, and compare products from
                any uploaded catalog — all in one place.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Features Grid ─── */}
      <section id="features" className="paper-texture py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="animate-fade-in-up text-center text-3xl font-extrabold tracking-tight sm:text-4xl">
            Everything You Need to{" "}
            <span className="gradient-text">Digitize Procurement</span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-slate-500">
            From raw PDF catalogs to actionable intelligence — a complete toolkit
            for modern distributors and procurement teams.
          </p>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "PDF Catalog Extraction",
                desc: "Upload any catalog PDF. Our AI reads every page, extracts products, prices, specs — even from complex tabular grids.",
                icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-600">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                ),
              },
              {
                title: "Natural Language Search",
                desc: "Search in English, Hindi, or Hinglish. AI understands 'quickfit pipe 180mm 8kgf' and finds exactly what you need.",
                icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-600">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                ),
              },
              {
                title: "Cross-Brand Comparison",
                desc: "Find similar products across brands. Compare prices instantly to make better procurement decisions.",
                icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-600">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                ),
              },
              {
                title: "Image Search",
                desc: "Upload a product photo to find matching items in your catalogs. Visual AI identifies products by appearance.",
                icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-600">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                ),
              },
              {
                title: "Quick Quotations",
                desc: "Generate professional quotations in seconds. Select products, set margins, and share with clients.",
                icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-600">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <path d="M9 15l2 2 4-4" />
                  </svg>
                ),
              },
              {
                title: "Demand Intelligence",
                desc: "Track what distributors search for. Identify trending products and gaps in your catalog.",
                icon: (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-600">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                ),
              },
            ].map((f, i) => (
              <div
                key={f.title}
                className={`card-skeu animate-fade-in-up stagger-${i + 1 > 5 ? 5 : i + 1} p-6`}
              >
                <div className="metal-circle flex h-12 w-12 items-center justify-center rounded-full">
                  {f.icon}
                </div>
                <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── App Preview ─── */}
      <section className="bg-slate-50/60 py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <h2 className="animate-fade-in-up mb-12 text-center text-3xl font-extrabold tracking-tight sm:text-4xl">
            See It in <span className="gradient-text">Action</span>
          </h2>

          {/* Browser window */}
          <div
            className="animate-fade-in-up stagger-2 overflow-hidden rounded-2xl border border-slate-200 bg-white"
            style={{
              boxShadow:
                "0 20px 60px rgba(0,0,0,0.12), 0 8px 20px rgba(0,0,0,0.06)",
            }}
          >
            {/* Title bar */}
            <div className="flex items-center gap-2 border-b border-slate-100 bg-gradient-to-b from-slate-100 to-slate-50 px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-red-400" />
              <span className="h-3 w-3 rounded-full bg-yellow-400" />
              <span className="h-3 w-3 rounded-full bg-green-400" />
              <span className="ml-3 text-xs text-slate-400">
                catalogai.app/dashboard
              </span>
            </div>

            {/* Mock dashboard */}
            <div className="p-5">
              {/* Gradient banner */}
              <div className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-5">
                <div className="h-3 w-40 rounded bg-white/30" />
                <div className="mt-2 h-2 w-64 rounded bg-white/20" />
                <div className="mt-4 flex gap-4">
                  <div className="h-8 w-20 rounded-lg bg-white/20" />
                  <div className="h-8 w-20 rounded-lg bg-white/10" />
                </div>
              </div>

              {/* Cards row */}
              <div className="mt-5 grid grid-cols-3 gap-4">
                {[1, 2, 3].map((n) => (
                  <div
                    key={n}
                    className="rounded-xl border border-slate-100 bg-slate-50 p-4"
                  >
                    <div className="h-2 w-12 rounded bg-slate-200" />
                    <div className="mt-2 h-5 w-16 rounded bg-slate-300" />
                    <div className="mt-1 h-1.5 w-20 rounded bg-slate-100" />
                  </div>
                ))}
              </div>

              {/* Fake table */}
              <div className="mt-5 space-y-2">
                <div className="flex gap-3 rounded-lg bg-slate-50 px-3 py-2">
                  <div className="h-2 w-24 rounded bg-slate-200" />
                  <div className="h-2 w-32 rounded bg-slate-100" />
                  <div className="h-2 w-16 rounded bg-slate-200" />
                  <div className="h-2 w-20 rounded bg-slate-100" />
                </div>
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="flex gap-3 px-3 py-2">
                    <div className="h-2 w-24 rounded bg-slate-100" />
                    <div className="h-2 w-32 rounded bg-slate-50" />
                    <div className="h-2 w-16 rounded bg-slate-100" />
                    <div className="h-2 w-20 rounded bg-slate-50" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Stats Section ─── */}
      <section className="paper-texture py-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-8 md:grid-cols-3">
            {[
              { value: "10,000+", label: "Products Extracted" },
              { value: "50+", label: "Catalogs Processed" },
              { value: "AI", label: "Powered Intelligence" },
            ].map((s, i) => (
              <div
                key={s.label}
                className={`card-inset animate-fade-in-up stagger-${i + 1} rounded-2xl p-8 text-center`}
              >
                <p className="text-emboss text-4xl font-bold text-slate-800">
                  {s.value}
                </p>
                <p className="mt-2 text-sm font-medium text-slate-500">
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Final CTA ─── */}
      <section className="bg-gradient-to-r from-indigo-600 to-violet-600 py-20">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="animate-fade-in-up text-3xl font-extrabold text-white sm:text-4xl">
            Ready to Transform Your Procurement?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-indigo-100">
            Join distributors already saving hours every week. Start extracting
            products from your catalogs today.
          </p>
          <div className="mt-8">
            <Link
              href="/sign-up"
              className="btn-skeu inline-block rounded-xl px-8 py-3.5 text-base font-semibold"
              style={{
                background: "linear-gradient(180deg, #ffffff 0%, #f1f5f9 100%)",
                color: "#1e293b",
                textShadow: "none",
                border: "1px solid rgba(0,0,0,0.08)",
                boxShadow:
                  "0 1px 0 0 rgba(255,255,255,0.9) inset, 0 -2px 4px 0 rgba(0,0,0,0.06) inset, 0 4px 16px rgba(0,0,0,0.15), 0 2px 4px rgba(0,0,0,0.08)",
              }}
            >
              Get Started Free
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="bg-gradient-to-b from-slate-900 to-slate-950 py-14 text-slate-400">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-8 md:flex-row md:items-start">
            {/* Brand */}
            <div className="text-center md:text-left">
              <div className="flex items-center justify-center gap-2 md:justify-start">
                <Image src="/logo.svg" alt="CatalogAI" width={24} height={24} />
                <span className="text-lg font-bold text-white">CatalogAI</span>
              </div>
              <p className="mt-2 max-w-xs text-sm text-slate-500">
                AI-powered catalog extraction and procurement intelligence for
                modern distributors.
              </p>
            </div>

            {/* Links */}
            <div className="flex flex-wrap justify-center gap-6 text-sm md:justify-end">
              <Link
                href="/dashboard"
                className="transition-colors hover:text-white"
              >
                Dashboard
              </Link>
              <Link
                href="/search"
                className="transition-colors hover:text-white"
              >
                Search
              </Link>
              <Link
                href="/upload"
                className="transition-colors hover:text-white"
              >
                Upload
              </Link>
              <Link
                href="/sign-in"
                className="transition-colors hover:text-white"
              >
                Sign In
              </Link>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-slate-800 pt-8 text-xs text-slate-500 md:flex-row">
            <p>&copy; 2026 CatalogAI</p>
            <p className="flex items-center gap-1.5">
              Powered by Claude AI
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
