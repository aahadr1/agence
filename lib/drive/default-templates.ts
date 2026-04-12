import type { DriveDocJson, DriveTemplate } from "@/lib/drive/types";

function paragraph(text: string): DriveDocJson {
  return {
    type: "paragraph",
    content: text ? [{ type: "text", text }] : [],
  };
}

function heading(level: 1 | 2 | 3, text: string): DriveDocJson {
  return {
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  };
}

function bullet(items: string[]): DriveDocJson {
  return {
    type: "bulletList",
    content: items.map((item) => ({
      type: "listItem",
      content: [paragraph(item)],
    })),
  };
}

function checklist(items: string[]): DriveDocJson {
  return {
    type: "taskList",
    content: items.map((item) => ({
      type: "taskItem",
      attrs: { checked: false },
      content: [paragraph(item)],
    })),
  };
}

function doc(...content: DriveDocJson[]): DriveDocJson {
  return { type: "doc", content };
}

export const DEFAULT_DRIVE_TEMPLATES: DriveTemplate[] = [
  {
    id: "blank",
    kind: "built_in",
    name: "Blank document",
    description: "Start from a clean page.",
    content: doc(paragraph("")),
  },
  {
    id: "meeting-notes",
    kind: "built_in",
    name: "Meeting Notes",
    description: "Agenda, decisions, and next steps in one place.",
    content: doc(
      heading(1, "Meeting Notes"),
      paragraph("Date:"),
      paragraph("Attendees:"),
      heading(2, "Agenda"),
      bullet(["Topic 1", "Topic 2", "Topic 3"]),
      heading(2, "Notes"),
      paragraph(""),
      heading(2, "Decisions"),
      bullet(["Decision 1"]),
      heading(2, "Next Steps"),
      checklist(["Owner - task - due date"])
    ),
  },
  {
    id: "sop",
    kind: "built_in",
    name: "SOP",
    description: "A simple standard operating procedure layout.",
    content: doc(
      heading(1, "Standard Operating Procedure"),
      paragraph("Purpose"),
      heading(2, "When to use this"),
      bullet(["Scenario 1", "Scenario 2"]),
      heading(2, "Steps"),
      checklist(["Step 1", "Step 2", "Step 3"]),
      heading(2, "Notes"),
      paragraph("")
    ),
  },
  {
    id: "proposal",
    kind: "built_in",
    name: "Proposal",
    description: "A lightweight client or internal proposal structure.",
    content: doc(
      heading(1, "Proposal"),
      heading(2, "Context"),
      paragraph(""),
      heading(2, "Scope"),
      bullet(["Deliverable 1", "Deliverable 2"]),
      heading(2, "Timeline"),
      paragraph(""),
      heading(2, "Budget"),
      paragraph(""),
      heading(2, "Next Step"),
      paragraph("")
    ),
  },
  {
    id: "client-brief",
    kind: "built_in",
    name: "Client Brief",
    description: "Capture requirements, constraints, and success criteria.",
    content: doc(
      heading(1, "Client Brief"),
      paragraph("Client:"),
      paragraph("Owner:"),
      heading(2, "Objectives"),
      bullet(["Objective 1"]),
      heading(2, "Audience"),
      paragraph(""),
      heading(2, "Constraints"),
      bullet(["Constraint 1"]),
      heading(2, "Success Metrics"),
      bullet(["Metric 1"])
    ),
  },
  {
    id: "project-notes",
    kind: "built_in",
    name: "Project Notes",
    description: "Ongoing notes, links, and open questions.",
    content: doc(
      heading(1, "Project Notes"),
      heading(2, "Summary"),
      paragraph(""),
      heading(2, "Updates"),
      bullet([""]),
      heading(2, "Open Questions"),
      checklist([""])
    ),
  },
  {
    id: "knowledge-base",
    kind: "built_in",
    name: "Knowledge Base Article",
    description: "A clear internal knowledge article layout.",
    content: doc(
      heading(1, "Knowledge Base Article"),
      paragraph("Summary"),
      heading(2, "Context"),
      paragraph(""),
      heading(2, "Instructions"),
      checklist([""]),
      heading(2, "Troubleshooting"),
      bullet([""])
    ),
  },
  {
    id: "weekly-report",
    kind: "built_in",
    name: "Weekly Report",
    description: "A concise update for weekly internal reporting.",
    content: doc(
      heading(1, "Weekly Report"),
      paragraph("Week of:"),
      heading(2, "Wins"),
      bullet([""]),
      heading(2, "Risks"),
      bullet([""]),
      heading(2, "Focus Next Week"),
      checklist([""])
    ),
  },
];
