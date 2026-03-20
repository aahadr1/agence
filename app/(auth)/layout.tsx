import { ThemeToggle } from "@/components/theme/theme-toggle";
import Image from "next/image";
import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 md:px-10 md:py-4">
        <Link href="/login" className="block">
          <div className="overflow-hidden rounded-sm bg-white px-2 py-1.5 md:px-3 md:py-2">
            <Image
              src="/logo.png"
              alt="LàHaut Agency"
              width={100}
              height={50}
              className="h-auto w-auto object-contain"
              priority
            />
          </div>
        </Link>
        <ThemeToggle />
      </div>
      <div className="mx-auto flex min-h-[calc(100svh-3.5rem)] max-w-md flex-col justify-center px-5 py-10 md:px-10 md:py-12">
        {children}
      </div>
    </div>
  );
}
