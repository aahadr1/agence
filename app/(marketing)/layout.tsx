import { MarketingHeader } from "./components/header";
import { MarketingFooter } from "./components/footer";
import { CursorGlow } from "./components/animations/cursor-glow";
import { MarketingMotionProvider } from "./components/animations/marketing-motion-provider";
import { MarketingAtmosphere } from "./components/animations/marketing-atmosphere";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      data-marketing-site
      className="min-h-screen flex flex-col grain-overlay relative"
      style={{
        background: "var(--bg-primary)",
        color: "var(--text-primary)",
      }}
    >
      <MarketingMotionProvider>
        <MarketingAtmosphere />
        <CursorGlow />
        <MarketingHeader />
        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <main className="flex-1">{children}</main>
          <MarketingFooter />
        </div>
      </MarketingMotionProvider>
    </div>
  );
}
