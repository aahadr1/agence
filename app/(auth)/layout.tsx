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
      <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4 md:px-10">
        <Link href="/login" className="block">
          <div className="overflow-hidden rounded-sm bg-white px-3 py-2">
            <Image
              src="/logo.png"
              alt="LàHaut Agency"
              width={130}
              height={65}
              className="h-auto w-auto object-contain"
              priority
            />
          </div>
        </Link>
        <ThemeToggle />
      </div>
      <div className="mx-auto flex min-h-[calc(100vh-4.25rem)] max-w-md flex-col justify-center px-6 py-12 md:px-10">
        {children}
      </div>
    </div>
  );
}
