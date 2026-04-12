export const NAV_ITEMS = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: "LayoutDashboard" as const,
  },
  {
    label: "Drive",
    href: "/drive",
    icon: "FolderOpen" as const,
  },
  {
    label: "Messagerie",
    href: "/messages",
    icon: "MessageSquare" as const,
  },
  {
    label: "Calendrier",
    href: "/calendar",
    icon: "Calendar" as const,
  },
  {
    label: "CRM",
    href: "/crm",
    icon: "KanbanSquare" as const,
  },
  {
    label: "Website Maker",
    href: "/website-maker",
    icon: "Globe" as const,
  },
  {
    label: "Website Hoster",
    href: "/website-hoster",
    icon: "Upload" as const,
  },
  {
    label: "Lead Generator",
    href: "/lead-generator",
    icon: "Search" as const,
  },
  {
    label: "Analyzer",
    href: "/business-analyzer",
    icon: "Radar" as const,
  },
  {
    label: "Appels",
    href: "/telephony",
    icon: "Phone" as const,
  },
] as const;

export const STEPS = [
  { id: 1, label: "Business Info", description: "Gather business details" },
  { id: 2, label: "Concepts", description: "AI generates 3 designs" },
  { id: 3, label: "Selection", description: "Choose your favorite" },
  { id: 4, label: "Build", description: "AI builds your website" },
] as const;
