import { ThemeToggle } from "@/components/theme/theme-toggle";
import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-5 md:px-10">
        <div>
          <Link
            href="/login"
            className="font-display text-lg font-medium tracking-tight text-foreground"
          >
            Agence
          </Link>
          <span className="ml-3 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Studio
          </span>
        </div>
        <ThemeToggle />
      </div>
      <div className="mx-auto flex min-h-[calc(100vh-4.25rem)] max-w-md flex-col justify-center px-6 py-12 md:px-10">
        {children}
      </div>
    </div>
  );
}
