import { BetaBanner } from "@/components/beta-banner";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BetaBanner />
      {children}
    </>
  );
}
