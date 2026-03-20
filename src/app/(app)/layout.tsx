import { Sidebar } from "@/components/sidebar";
import { BetaBanner } from "@/components/beta-banner";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BetaBanner />
      <div className="flex h-full">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-gradient-to-br from-slate-50 to-white md:ml-0">
          <div className="pt-14 md:pt-0 animate-fade-in">
            {children}
          </div>
        </main>
      </div>
    </>
  );
}
