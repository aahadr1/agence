import { Sidebar } from "@/components/layout/sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      {/* pt-14 clears the mobile top bar; lg:pt-0 + lg:pl removes it on desktop */}
      <main className="min-h-screen pt-14 lg:pt-0 lg:pl-[var(--sidebar-width)]">
        <div className="mx-auto min-w-0 max-w-6xl px-4 py-8 sm:px-6 sm:py-10 md:px-10 md:py-12">
          {children}
        </div>
      </main>
    </div>
  );
}
