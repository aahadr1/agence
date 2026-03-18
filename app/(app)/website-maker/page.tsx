"use client";

import { createClient } from "@/lib/supabase/client";
import { Project } from "@/lib/types";
import { Globe, Plus, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

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

  const statusLabel: Record<string, string> = {
    info_gathering: "Gathering Info",
    ideation: "Generating Concepts",
    selection: "Awaiting Selection",
    completed: "Completed",
  };

  const statusColor: Record<string, string> = {
    info_gathering: "bg-yellow-500/20 text-yellow-400",
    ideation: "bg-blue-500/20 text-blue-400",
    selection: "bg-purple-500/20 text-purple-400",
    completed: "bg-green-500/20 text-green-400",
  };

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Website Maker</h1>
          <p className="text-muted-foreground mt-1">
            Create AI-powered websites for any business
          </p>
        </div>
        <Link
          href="/website-maker/new"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all shadow-lg shadow-primary/25"
        >
          <Plus className="w-4 h-4" />
          New Project
        </Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-2xl border border-border bg-card p-5 h-40 animate-shimmer"
            />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center">
          <div className="inline-flex items-center justify-center p-4 rounded-2xl bg-secondary mb-4">
            <Globe className="w-10 h-10 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            No projects yet
          </h2>
          <p className="text-muted-foreground text-sm mb-6 max-w-md mx-auto">
            Start by creating your first AI-powered website. Just enter a
            business name and address, and our AI will do the rest.
          </p>
          <Link
            href="/website-maker/new"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all"
          >
            <Plus className="w-4 h-4" />
            Create Your First Website
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/website-maker/${project.id}`}
              className="group rounded-2xl border border-border bg-card p-5 hover:border-primary/30 transition-all duration-300"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="p-2 rounded-xl bg-primary/10">
                  <Globe className="w-5 h-5 text-primary" />
                </div>
                <span
                  className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${
                    statusColor[project.status]
                  }`}
                >
                  {statusLabel[project.status]}
                </span>
              </div>
              <h3 className="font-semibold text-foreground mb-1">
                {project.business_info?.name || "Untitled"}
              </h3>
              <p className="text-xs text-muted-foreground mb-4 line-clamp-2">
                {project.business_info?.address || "No address"}
              </p>
              <div className="flex items-center text-xs text-primary font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                Continue <ArrowRight className="w-3 h-3 ml-1" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
