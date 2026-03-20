"use client";

import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { createClient } from "@/lib/supabase/client";
import { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ArrowUpRight, Globe, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

const statusLabel: Record<string, string> = {
  info_gathering: "Profile",
  ideation: "Concepts",
  selection: "Selection",
  completed: "Ready",
  building: "Building",
  deployed: "Live",
};

export default function WebsiteMakerPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const fetchProjects = async () => {
      const { data } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });
      setProjects(data || []);
      setLoading(false);
    };
    fetchProjects();
  }, [supabase]);

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Website maker"
        title="Projects"
        description="Each row is a business profile, concepts, and build. Open one to continue where you left off."
      >
        <Link href="/website-maker/new" className="btn-solid">
          <Plus className="h-4 w-4" strokeWidth={1.5} />
          New project
        </Link>
      </PageHeader>

      <div className="border-t border-border pt-10 md:pt-12">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-36 border border-border bg-card animate-shimmer"
              />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <Panel padding="lg" className="rounded-sm">
            <div className="flex flex-col items-center py-14 text-center md:py-16">
              <Globe
                className="mb-5 h-8 w-8 text-muted-foreground"
                strokeWidth={1}
              />
              <p className="label-eyebrow mb-3">Empty</p>
              <h2 className="font-display text-xl font-medium text-foreground md:text-2xl">
                No projects yet
              </h2>
              <p className="mt-2 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                Add a business name, address, and logo. Research and mockups
                follow automatically.
              </p>
              <Link href="/website-maker/new" className="btn-solid mt-8">
                <Plus className="h-4 w-4" strokeWidth={1.5} />
                Start first project
              </Link>
            </div>
          </Panel>
        ) : (
          <ul className="divide-y divide-border border border-border bg-card">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/website-maker/${project.id}`}
                  className="group flex flex-col gap-3 px-5 py-5 transition-colors hover:bg-secondary/40 md:flex-row md:items-center md:justify-between md:px-6 md:py-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">
                      {project.business_info?.name || "Untitled"}
                    </p>
                    <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                      {project.business_info?.address || "No address"}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span
                      className={cn(
                        "text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
                      )}
                    >
                      {statusLabel[project.status] || project.status}
                    </span>
                    <ArrowUpRight
                      className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                      strokeWidth={1.25}
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
