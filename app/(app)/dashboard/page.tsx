"use client";

import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { useAuth } from "@/components/auth/auth-provider";
import { Activity, Globe, TrendingUp, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

const stats = [
  {
    label: "Projects",
    value: "0",
    change: "—",
    icon: Globe,
  },
  {
    label: "Live sites",
    value: "0",
    change: "—",
    icon: Activity,
  },
  {
    label: "Visitors",
    value: "—",
    change: "—",
    icon: Users,
  },
  {
    label: "Conversion",
    value: "—",
    change: "—",
    icon: TrendingUp,
  },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const first = user?.email?.split("@")[0] || "there";

  return (
    <div className="animate-fade-in">
      <div className="mb-10 inline-block overflow-hidden rounded-sm bg-white px-4 py-3 shadow-none ring-1 ring-border">
        <Image
          src="/logo.png"
          alt="LàHaut Agency"
          width={180}
          height={90}
          className="h-auto w-auto object-contain"
          priority
        />
      </div>

      <PageHeader
        eyebrow="Overview"
        title={`Hello, ${first}`}
        description="A calm place to build sites and find leads. Pick a tool below when you're ready."
      />

      <Section borderTop className="py-10 md:py-12">
        <p className="label-eyebrow mb-6">Snapshot</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <Panel
              key={stat.label}
              padding="md"
              className="flex flex-col gap-4 rounded-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {stat.label}
                </span>
                <stat.icon
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.25}
                />
              </div>
              <p className="font-display text-2xl font-medium tracking-tight text-foreground md:text-3xl">
                {stat.value}
              </p>
              <p className="text-xs text-muted-foreground">{stat.change}</p>
            </Panel>
          ))}
        </div>
      </Section>

      <Section borderTop className="py-10 md:py-12">
        <p className="label-eyebrow mb-6">Activity</p>
        <Panel padding="lg" className="rounded-sm">
          <div className="flex flex-col items-center py-10 text-center md:py-14">
            <Globe
              className="mb-5 h-8 w-8 text-muted-foreground"
              strokeWidth={1}
            />
            <p className="max-w-sm text-[15px] leading-relaxed text-muted-foreground">
              Nothing here yet. Start a website project to see progress and
              previews in one place.
            </p>
            <Link
              href="/website-maker"
              className="btn-solid mt-8"
            >
              New website project
            </Link>
          </div>
        </Panel>
      </Section>
    </div>
  );
}
