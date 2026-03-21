"use client";

import Image from "next/image";
import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* ─── Navigation ─── */}
      <nav className="dark-glass sticky top-0 z-50 border-b border-white/5">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.svg" alt="CatalogAI" width={28} height={28} />
            <span className="text-lg font-bold tracking-tight text-white">
              CatalogAI
            </span>
          </Link>

          <div className="flex items-center gap-2 sm:gap-6">
            <a
              href="#features"
              className="hidden text-sm font-medium text-slate-400 transition-colors hover:text-white sm:inline-block"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="hidden text-sm font-medium text-slate-400 transition-colors hover:text-white sm:inline-block"
            >
              How It Works
            </a>
            <Link
              href="/sign-in"
              className="text-sm font-medium text-slate-400 transition-colors hover:text-white"
            >
              Sign In
            </Link>
            <Link
              href="/sign-up"
              className="glow-btn rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* ─── Hero Section ─── */}
      <section className="relative flex min-h-screen items-center overflow-hidden">
        {/* Aurora blobs */}
        <div className="aurora-blob left-1/4 top-1/4 h-[500px] w-[500px] bg-indigo-600/30" />
        <div
          className="aurora-blob right-1/4 top-1/3 h-[400px] w-[400px] bg-violet-600/20"
          style={{ animationDelay: "-4s" }}
        />
        <div
          className="aurora-blob bottom-1/4 left-1/3 h-[350px] w-[350px] bg-cyan-500/15"
          style={{ animationDelay: "-8s" }}
        />

        {/* Dot grid overlay */}
        <div className="dot-grid absolute inset-0" />

        {/* Hero content */}
        <div className="relative z-10 mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
          {/* Badge chip */}
          <div className="animate-fade-in-up inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-4 py-1.5 text-sm font-medium text-indigo-300"
            style={{ boxShadow: "0 0 20px rgba(99,102,241,0.15)" }}
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
            AI-Powered Catalog Intelligence
          </div>

          {/* Headline */}
          <h1 className="animate-fade-in-up stagger-1 mt-8 text-5xl font-extrabold leading-[1.1] tracking-tight sm:text-6xl lg:text-7xl">
            Turn PDFs into
            <br />
            <span className="gradient-text-landing">
              Procurement Intelligence
            </span>
          </h1>

          {/* Subheadline */}
          <p className="animate-fade-in-up stagger-2 mx-auto mt-6 max-w-2xl text-lg text-slate-400 sm:text-xl">
            Upload any supplier catalog and let AI extract every product, price,
            and specification in minutes — not days. Search across brands in
            plain English and generate quotations instantly.
          </p>

          {/* CTA buttons */}
          <div className="animate-fade-in-up stagger-3 mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/sign-up"
              className="glow-btn rounded-xl bg-indigo-600 px-8 py-3.5 text-base font-semibold"
            >
              Get Started Free
            </Link>
            <Link
              href="/dashboard"
              className="rounded-xl border border-slate-700 bg-slate-900/50 px-8 py-3.5 text-base font-semibold text-slate-300 transition-all hover:border-slate-600 hover:text-white"
            >
              Explore Dashboard &rarr;
            </Link>
          </div>

          {/* Trust line */}
          <p className="animate-fade-in-up stagger-4 mt-8 text-sm text-slate-500">
            Trusted by procurement teams processing thousands of catalog pages
            daily.
          </p>
        </div>
      </section>

      {/* ─── Product Demo ─── */}
      <section className="relative py-20">
        {/* Radial glow */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[800px] -translate-x-1/2 -translate-y-1/2"
          style={{
            background:
              "radial-gradient(ellipse, rgba(99,102,241,0.2) 0%, transparent 70%)",
          }}
        />

        <div className="relative mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="glow-frame animate-fade-in-up-slow rounded-2xl bg-slate-900 overflow-hidden">
            {/* Title bar */}
            <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-red-500/60" />
              <span className="h-3 w-3 rounded-full bg-yellow-500/60" />
              <span className="h-3 w-3 rounded-full bg-green-500/60" />
              <span className="ml-3 font-mono text-xs text-slate-500">
                catalogai.app/dashboard
              </span>
            </div>

            {/* Interior */}
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

              {/* Stat cards */}
              <div className="mt-5 grid grid-cols-3 gap-4">
                {[1, 2, 3].map((n) => (
                  <div
                    key={n}
                    className="rounded-xl border border-slate-800 bg-slate-800/50 p-4"
                  >
                    <div className="h-2 w-12 rounded bg-slate-700" />
                    <div className="mt-2 h-5 w-16 rounded bg-slate-600" />
                    <div className="mt-1 h-1.5 w-20 rounded bg-slate-700" />
                  </div>
                ))}
              </div>

              {/* Fake table rows */}
              <div className="mt-5 space-y-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <div
                    key={n}
                    className="flex gap-3 rounded-lg bg-slate-800/40 px-3 py-2"
                  >
                    <div className="h-2 w-24 rounded bg-slate-700" />
                    <div className="h-2 w-32 rounded bg-slate-800" />
                    <div className="h-2 w-16 rounded bg-slate-700" />
                    <div className="h-2 w-20 rounded bg-slate-800" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Features ─── */}
      <section id="features" className="dot-grid relative py-20">
        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* Section label */}
          <div className="flex items-center justify-center gap-4">
            <span className="h-px w-8 bg-indigo-500" />
            <span className="font-mono text-sm uppercase tracking-widest text-indigo-400">
              Features
            </span>
            <span className="h-px w-8 bg-indigo-500" />
          </div>

          <h2 className="animate-fade-in-up mt-4 text-center text-3xl font-extrabold tracking-tight sm:text-4xl">
            Everything You Need to{" "}
            <span className="gradient-text-landing">Digitize Procurement</span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-slate-400">
            From raw PDF catalogs to actionable intelligence — a complete
            toolkit for modern distributors and procurement teams.
          </p>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "PDF Catalog Extraction",
                desc: "Upload any catalog PDF. Our AI reads every page, extracts products, prices, specs — even from complex tabular grids.",
                icon: (
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
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
                desc: "Search in English, Hindi, or Hinglish. AI understands context and finds exactly what you need across all catalogs.",
                icon: (
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                ),
              },
              {
                title: "Cross-Brand Comparison",
                desc: "Find similar products across brands. Compare prices instantly to make better procurement decisions.",
                icon: (
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
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
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
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
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <path d="M9 15l2 2 4-4" />
                  </svg>
                ),
              },
              {
                title: "Demand Intelligence",
                desc: "Track what distributors search for. Identify trending products and gaps in your catalog coverage.",
                icon: (
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                ),
              },
            ].map((f, i) => (
              <div
                key={f.title}
                className={`glow-border-card animate-fade-in-up stagger-${Math.min(i + 1, 5)} rounded-2xl bg-slate-900/80 p-6`}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                  {f.icon}
                </div>
                <h3 className="mt-4 text-lg font-bold text-white">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm text-slate-400">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section id="how-it-works" className="relative py-20">
        {/* Radial violet glow */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[800px] -translate-x-1/2 -translate-y-1/2"
          style={{
            background:
              "radial-gradient(ellipse, rgba(139,92,246,0.15) 0%, transparent 70%)",
          }}
        />

        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* Section label */}
          <div className="flex items-center justify-center gap-4">
            <span className="h-px w-8 bg-violet-500" />
            <span className="font-mono text-sm uppercase tracking-widest text-violet-400">
              How It Works
            </span>
            <span className="h-px w-8 bg-violet-500" />
          </div>

          <h2 className="animate-fade-in-up mt-4 text-center text-3xl font-extrabold tracking-tight sm:text-4xl">
            Three Steps to{" "}
            <span className="gradient-text-landing">Catalog Intelligence</span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-slate-400">
            Transform raw PDF catalogs into structured, searchable product data
            in minutes.
          </p>

          {/* Steps grid */}
          <div className="relative mt-14 grid gap-8 md:grid-cols-3">
            {/* Connecting line */}
            <div
              className="step-line absolute top-10 hidden md:block"
              style={{ left: "16.67%", right: "16.67%" }}
            />

            {/* Step 1 */}
            <div className="animate-fade-in-up stagger-1 flex flex-col items-center text-center">
              <div
                className="flex h-20 w-20 items-center justify-center rounded-full border border-indigo-500/30 bg-slate-900 text-2xl font-bold text-indigo-400"
                style={{
                  boxShadow:
                    "0 0 30px rgba(99,102,241,0.2), 0 0 60px rgba(99,102,241,0.1)",
                }}
              >
                1
              </div>
              <h3 className="mt-6 text-xl font-bold text-white">
                Upload PDF
              </h3>
              <p className="mt-3 max-w-xs text-sm text-slate-400">
                Drag and drop any supplier catalog PDF. We handle multi-page
                documents with complex layouts and tabular data.
              </p>
            </div>

            {/* Step 2 */}
            <div className="animate-fade-in-up stagger-2 flex flex-col items-center text-center">
              <div
                className="flex h-20 w-20 items-center justify-center rounded-full border border-indigo-500/30 bg-slate-900 text-2xl font-bold text-indigo-400"
                style={{
                  boxShadow:
                    "0 0 30px rgba(99,102,241,0.2), 0 0 60px rgba(99,102,241,0.1)",
                }}
              >
                2
              </div>
              <h3 className="mt-6 text-xl font-bold text-white">
                AI Extracts
              </h3>
              <p className="mt-3 max-w-xs text-sm text-slate-400">
                Claude AI reads each page, identifying products, prices,
                specifications, and catalog numbers with remarkable accuracy.
              </p>
            </div>

            {/* Step 3 */}
            <div className="animate-fade-in-up stagger-3 flex flex-col items-center text-center">
              <div
                className="flex h-20 w-20 items-center justify-center rounded-full border border-indigo-500/30 bg-slate-900 text-2xl font-bold text-indigo-400"
                style={{
                  boxShadow:
                    "0 0 30px rgba(99,102,241,0.2), 0 0 60px rgba(99,102,241,0.1)",
                }}
              >
                3
              </div>
              <h3 className="mt-6 text-xl font-bold text-white">
                Search &amp; Compare
              </h3>
              <p className="mt-3 max-w-xs text-sm text-slate-400">
                Use natural language to search, filter, and compare products
                from any uploaded catalog — all in one place.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Stats ─── */}
      <section className="relative py-20">
        <div className="mx-auto grid max-w-5xl gap-8 px-4 sm:px-6 md:grid-cols-3 lg:px-8">
          {[
            { value: "10,000+", label: "Products Extracted" },
            { value: "50+", label: "Catalogs Processed" },
            { value: "5x", label: "Faster Than Manual" },
          ].map((s) => (
            <div
              key={s.label}
              className="relative rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center"
            >
              {/* Radial glow behind number */}
              <div
                className="pointer-events-none absolute left-1/2 top-8 h-20 w-32 -translate-x-1/2"
                style={{
                  background:
                    "radial-gradient(ellipse, rgba(99,102,241,0.2) 0%, transparent 70%)",
                }}
              />
              <p className="relative text-4xl font-bold text-white">
                {s.value}
              </p>
              <p className="mt-2 text-sm font-medium text-slate-400">
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="relative py-20">
        {/* Radial glow */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[500px] w-[700px] -translate-x-1/2 -translate-y-1/2"
          style={{
            background:
              "radial-gradient(ellipse, rgba(99,102,241,0.2) 0%, transparent 70%)",
          }}
        />

        <div className="relative z-10 mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="animate-fade-in-up text-3xl font-extrabold tracking-tight sm:text-4xl">
            Ready to Transform Your{" "}
            <span className="gradient-text-landing">Procurement?</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-slate-400">
            Join distributors already saving hours every week. Start extracting
            products from your catalogs today.
          </p>
          <div className="mt-8">
            <Link
              href="/sign-up"
              className="glow-btn inline-block rounded-xl bg-indigo-600 px-8 py-3.5 text-base font-semibold"
            >
              Get Started Free
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-slate-800 py-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-8 md:flex-row md:items-start">
            {/* Brand */}
            <div className="text-center md:text-left">
              <div className="flex items-center justify-center gap-2 md:justify-start">
                <Image
                  src="/logo.svg"
                  alt="CatalogAI"
                  width={24}
                  height={24}
                />
                <span className="text-lg font-bold text-white">CatalogAI</span>
              </div>
              <p className="mt-2 max-w-xs text-sm text-slate-500">
                AI-powered catalog extraction and procurement intelligence for
                modern distributors.
              </p>
            </div>

            {/* Links */}
            <div className="flex flex-wrap justify-center gap-6 text-sm text-slate-400 md:justify-end">
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
              <span
                className="inline-block h-2 w-2 rounded-full bg-emerald-400"
                style={{
                  boxShadow: "0 0 6px rgba(52,211,153,0.6)",
                }}
              />
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
