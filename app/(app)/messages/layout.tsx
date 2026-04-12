export default function MessagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="-mx-4 w-[calc(100%+2rem)] max-w-none sm:-mx-6 sm:w-[calc(100%+3rem)] md:-mx-10 md:w-[calc(100%+5rem)] lg:mx-0 lg:w-full">
      <div className="flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden rounded-sm border border-border/70 bg-background/95 shadow-sm backdrop-blur-sm dark:border-border lg:h-[min(calc(100dvh-7rem),920px)]">
        {children}
      </div>
    </div>
  );
}
