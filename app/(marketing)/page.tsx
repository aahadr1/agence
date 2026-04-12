import { HeroSection } from "./components/hero";
import { ServicesGrid } from "./components/services-grid";
import { StatsSection } from "./components/stats-section";
import { RealisationsSection } from "./components/realisations-section";
import { WhyUsSection } from "./components/why-us-section";
import { TestimonialsSection } from "./components/testimonials";
import { CtaSection } from "./components/cta-section";

export default function LandingPage() {
  return (
    <>
      <HeroSection />
      <ServicesGrid />
      <StatsSection />
      <RealisationsSection />
      <WhyUsSection />
      <TestimonialsSection />
      <CtaSection />
    </>
  );
}
