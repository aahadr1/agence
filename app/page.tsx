import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MarketingHeader } from "./(marketing)/components/header";
import { MarketingFooter } from "./(marketing)/components/footer";
import { HeroSection } from "./(marketing)/components/hero";
import { ServicesGrid } from "./(marketing)/components/services-grid";
import { StatsSection } from "./(marketing)/components/stats-section";
import { RealisationsSection } from "./(marketing)/components/realisations-section";
import { WhyUsSection } from "./(marketing)/components/why-us-section";
import { TestimonialsSection } from "./(marketing)/components/testimonials";
import { CtaSection } from "./(marketing)/components/cta-section";
import { CursorGlow } from "./(marketing)/components/animations/cursor-glow";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-cream dark:bg-ink text-ink dark:text-cream flex flex-col grain-overlay">
      <CursorGlow />
      <MarketingHeader />
      <main className="flex-1">
        <HeroSection />
        <ServicesGrid />
        <StatsSection />
        <RealisationsSection />
        <WhyUsSection />
        <TestimonialsSection />
        <CtaSection />
      </main>
      <MarketingFooter />
    </div>
  );
}
