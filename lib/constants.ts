export const NAV_ITEMS = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: "LayoutDashboard" as const,
  },
  {
    label: "Website Maker",
    href: "/website-maker",
    icon: "Globe" as const,
  },
] as const;

export const STEPS = [
  { id: 1, label: "Business Info", description: "Gather business details" },
  { id: 2, label: "Concepts", description: "AI generates 3 designs" },
  { id: 3, label: "Selection", description: "Choose your favorite" },
  { id: 4, label: "Build", description: "AI builds your website" },
] as const;
