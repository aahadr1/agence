"use client";

import { useAuth } from "@/components/auth/auth-provider";
import {
  Activity,
  Globe,
  TrendingUp,
  Users,
} from "lucide-react";

const stats = [
  {
    label: "Total Projects",
    value: "0",
    change: "+0%",
    icon: Globe,
  },
  {
    label: "Active Websites",
    value: "0",
    change: "+0%",
    icon: Activity,
  },
  {
    label: "Total Visitors",
    value: "—",
    change: "—",
    icon: Users,
  },
  {
    label: "Conversion Rate",
    value: "—",
    change: "—",
    icon: TrendingUp,
  },
];

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Welcome back, {user?.email?.split("@")[0] || "there"}
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-border bg-card p-5 hover:border-primary/30 transition-all duration-300"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">
                {stat.label}
              </span>
              <div className="p-2 rounded-xl bg-primary/10">
                <stat.icon className="w-4 h-4 text-primary" />
              </div>
            </div>
            <p className="text-2xl font-bold text-foreground">{stat.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{stat.change}</p>
          </div>
        ))}
      </div>

      {/* Recent activity placeholder */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Recent Activity
        </h2>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="p-4 rounded-2xl bg-secondary mb-4">
            <Globe className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground text-sm">
            No activity yet. Create your first website to get started!
          </p>
          <a
            href="/website-maker"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-all"
          >
            Create Website
          </a>
        </div>
      </div>
    </div>
  );
}
