export default function CalendarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="-mx-4 w-[calc(100%+2rem)] max-w-none sm:-mx-6 sm:w-[calc(100%+3rem)] md:-mx-10 md:w-[calc(100%+5rem)] lg:mx-0 lg:w-full">
      <div className="flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden rounded-2xl border border-border/60 bg-[#fafafa] shadow-sm dark:border-border dark:bg-zinc-950/95 lg:h-[min(calc(100dvh-7rem),960px)]">
        {children}
      </div>
    </div>
  );
}
