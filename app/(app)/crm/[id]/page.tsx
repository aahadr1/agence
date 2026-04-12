"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { CrmOpportunity, CrmAccount, CrmContact, CrmActivity, CrmTask, CrmStage } from "@/lib/crm/types";
import { ProspectDetailHeader } from "../components/prospect-detail-header";
import { ActivityTimeline } from "../components/activity-timeline";
import { TaskList } from "../components/task-list";
import { AccountCard } from "../components/account-card";
import { ContactCard } from "../components/contact-card";
import { ArrowRight } from "lucide-react";

type StageHistoryEntry = {
  id: string;
  from_stage_id: string | null;
  to_stage_id: string;
  changed_by: string | null;
  changed_at: string;
};

export default function ProspectDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [opportunity, setOpportunity] = useState<CrmOpportunity | null>(null);
  const [account, setAccount] = useState<CrmAccount | null>(null);
  const [contact, setContact] = useState<CrmContact | null>(null);
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [stages, setStages] = useState<CrmStage[]>([]);
  const [stageHistory, setStageHistory] = useState<StageHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"timeline" | "tasks">("timeline");

  const loadData = useCallback(async () => {
    try {
      const [prospectRes, boardRes] = await Promise.all([
        fetch(`/api/crm/v2/prospects/${id}`),
        fetch("/api/crm/v2/board"),
      ]);

      const prospectData = await prospectRes.json();
      if (!prospectRes.ok) throw new Error(prospectData.error || "Failed to load prospect");

      const boardData = await boardRes.json();

      setOpportunity(prospectData.opportunity);
      setAccount(prospectData.account || null);
      setContact(prospectData.contact || null);
      setActivities(prospectData.activities || []);
      setTasks(prospectData.tasks || []);
      setStages(boardData.stages || []);

      if (prospectData.stageHistory) {
        setStageHistory(prospectData.stageHistory);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load prospect");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleUpdate = async (patch: Record<string, unknown>) => {
    if (!opportunity) return;
    const res = await fetch(`/api/crm/v2/prospects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      loadData();
    }
  };

  if (loading) {
    return (
      <div className="animate-fade-in flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading prospect...</p>
      </div>
    );
  }

  if (error || !opportunity) {
    return (
      <div className="animate-fade-in py-20 text-center">
        <p className="text-sm text-destructive">{error || "Prospect not found"}</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <ProspectDetailHeader
        opportunity={opportunity}
        stages={stages}
        onUpdate={handleUpdate}
      />

      {/* Content */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Left: Activities + Tasks */}
        <div className="lg:col-span-2 space-y-5">
          {/* Tabs */}
          <div className="flex gap-1 border-b border-border pb-0">
            {(["timeline", "tasks"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`border-b-2 px-3 py-2 text-xs font-medium capitalize transition-colors ${
                  activeTab === tab
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab === "timeline" ? "Activity timeline" : `Tasks (${tasks.filter((t) => t.status === "todo" || t.status === "in_progress").length})`}
              </button>
            ))}
          </div>

          {activeTab === "timeline" && (
            <ActivityTimeline
              activities={activities}
              opportunityId={opportunity.id}
              onActivityAdded={loadData}
            />
          )}

          {activeTab === "tasks" && (
            <TaskList
              tasks={tasks}
              opportunityId={opportunity.id}
              onTaskChanged={loadData}
            />
          )}
        </div>

        {/* Right: Cards */}
        <div className="space-y-4">
          <AccountCard account={account} />
          <ContactCard contact={contact} />

          {/* Opportunity details */}
          <div className="rounded-[var(--radius)] border border-border bg-card p-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Details</h3>
            <div className="mt-3 space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Source</span>
                <span className="capitalize text-foreground">{opportunity.source.replace("_", " ")}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Currency</span>
                <span className="text-foreground">{opportunity.currency}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Created</span>
                <span className="text-foreground">{new Date(opportunity.created_at).toLocaleDateString("fr-FR")}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Updated</span>
                <span className="text-foreground">{new Date(opportunity.updated_at).toLocaleDateString("fr-FR")}</span>
              </div>
              {opportunity.won_at && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Won at</span>
                  <span className="text-emerald-600">{new Date(opportunity.won_at).toLocaleDateString("fr-FR")}</span>
                </div>
              )}
              {opportunity.lost_at && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Lost at</span>
                  <span className="text-destructive">{new Date(opportunity.lost_at).toLocaleDateString("fr-FR")}</span>
                </div>
              )}
              {opportunity.loss_reason && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Loss reason: </span>
                  <span className="text-foreground">{opportunity.loss_reason}</span>
                </div>
              )}
            </div>
          </div>

          {/* Stage history */}
          {stageHistory.length > 0 && (
            <div className="rounded-[var(--radius)] border border-border bg-card p-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Stage history</h3>
              <div className="mt-3 space-y-2">
                {stageHistory.map((entry) => {
                  const fromStage = stages.find((s) => s.id === entry.from_stage_id);
                  const toStage = stages.find((s) => s.id === entry.to_stage_id);
                  return (
                    <div key={entry.id} className="flex items-center gap-1.5 text-xs">
                      {fromStage ? (
                        <span style={{ color: fromStage.color }}>{fromStage.name}</span>
                      ) : (
                        <span className="text-muted-foreground">Start</span>
                      )}
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                      {toStage && (
                        <span style={{ color: toStage.color }}>{toStage.name}</span>
                      )}
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {new Date(entry.changed_at).toLocaleDateString("fr-FR")}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
