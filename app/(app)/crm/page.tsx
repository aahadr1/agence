import { PageHeader } from "@/components/ui/page-header";
import { CrmShell } from "./crm-shell";

export default function CrmPage() {
  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="CRM"
        title="Agency CRM"
        description="One shared CRM for your whole agency: pipeline board, prospect timeline, tasks, follow-up meetings, and reporting."
      />
      <CrmShell />
    </div>
  );
}
