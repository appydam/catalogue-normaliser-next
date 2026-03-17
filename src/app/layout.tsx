import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import { ToastProvider } from "@/components/ui/toast-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CatalogAI – Your Supplier Intelligence Platform",
  description: "Turn supplier catalogs into business intelligence. Extract products from PDFs, compare prices across brands, track schemes, and optimize procurement.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
  },
  openGraph: {
    title: "CatalogAI – Your Supplier Intelligence Platform",
    description: "Turn supplier catalogs into business intelligence. Extract products from PDFs, compare prices across brands, track schemes, and optimize procurement.",
    siteName: "CatalogAI",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "CatalogAI – Your Supplier Intelligence Platform",
    description: "Turn supplier catalogs into business intelligence.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
        <TooltipProvider>
          <div className="flex h-full">
            <Sidebar />
            <main className="flex-1 overflow-y-auto bg-slate-50 md:ml-0">
              <div className="pt-14 md:pt-0">
                {children}
              </div>
            </main>
          </div>
          <ToastProvider />
        </TooltipProvider>
      </body>
    </html>
  );
}
