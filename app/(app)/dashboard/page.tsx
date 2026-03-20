"use client";

import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { useAuth } from "@/components/auth/auth-provider";
import { Activity, ArrowUpRight, Globe, TrendingUp, Users } from "lucide-react";
import Link from "next/link";

const stats = [
  {
    label: "Projects",
    value: "0",
    note: "Website builds started",
    icon: Globe,
  },
  {
    label: "Live sites",
    value: "0",
    note: "Published to the web",
    icon: Activity,
  },
  {
    label: "Visitors",
    value: "—",
    note: "Across all live sites",
    icon: Users,
  },
  {
    label: "Conversion",
    value: "—",
    note: "Leads captured per visit",
    icon: TrendingUp,
  },
];

const tools = [
  {
    eyebrow: "01",
    title: "Website Maker",
    description:
      "Feed in a business name and address. The AI researches the brand online, produces three visual mockups, then writes and deploys a complete multi-page site — in one sitting.",
    cta: "Open Website Maker",
    href: "/website-maker",
  },
  {
    eyebrow: "02",
    title: "Lead Generator",
    description:
      "Type a trade and a city. The agent maps local businesses, inspects every website, and surfaces the prospects most likely to need a new one — with outreach copy ready to send.",
    cta: "Open Lead Generator",
    href: "/lead-generator",
  },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const first = user?.email?.split("@")[0] || "there";

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Overview"
        title={`Hello, ${first}`}
        description="This is your studio. Build a site with AI or find local businesses that need one — pick a tool below when you're ready."
      />

      <Section borderTop className="py-10 md:py-12">
        <p className="label-eyebrow mb-6">Snapshot</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <Panel
              key={stat.label}
              padding="md"
              className="flex flex-col gap-3 rounded-sm"
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
              <p className="text-[11px] leading-snug text-muted-foreground">{stat.note}</p>
            </Panel>
          ))}
        </div>
      </Section>

      <Section borderTop className="py-10 md:py-12">
        <p className="label-eyebrow mb-6">Tools</p>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {tools.map((tool) => (
            <Panel key={tool.title} padding="lg" className="group rounded-sm">
              <p className="label-eyebrow mb-5">{tool.eyebrow}</p>
              <h2 className="font-display mb-3 text-xl font-medium tracking-tight text-foreground md:text-2xl">
                {tool.title}
              </h2>
              <p className="mb-8 text-[14px] leading-relaxed text-muted-foreground">
                {tool.description}
              </p>
              <Link
                href={tool.href}
                className="inline-flex items-center gap-2 text-[13px] font-medium text-foreground underline underline-offset-4 hover:no-underline"
              >
                {tool.cta}
                <ArrowUpRight className="h-4 w-4" strokeWidth={1.5} />
              </Link>
            </Panel>
          ))}
        </div>
      </Section>

      <Section borderTop className="py-10 md:py-12">
        <p className="label-eyebrow mb-6">Activity</p>
        <Panel padding="lg" className="rounded-sm">
          <div className="flex flex-col items-center py-8 text-center md:py-12">
            <Globe
              className="mb-5 h-8 w-8 text-muted-foreground"
              strokeWidth={1}
            />
            <h3 className="font-display mb-2 text-lg font-medium text-foreground">
              Nothing here yet
            </h3>
            <p className="max-w-sm text-[14px] leading-relaxed text-muted-foreground">
              Once you start a website project, progress updates and preview
              links will appear here so you can track each build at a glance.
            </p>
            <Link href="/website-maker" className="btn-solid mt-8">
              Start your first project
            </Link>
          </div>
        </Panel>
      </Section>
    </div>
  );
}
