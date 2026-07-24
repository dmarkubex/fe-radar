export function CuratedContentSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-6" aria-hidden="true">
      <section className="grid gap-0 shell:grid-cols-[1fr_280px]">
        <div className="border border-hairline bg-surface p-6">
          <div className="flex flex-wrap gap-2">
            <div className="h-4 w-12 animate-pulse rounded-none bg-bg-deep" />
            <div className="h-4 w-12 animate-pulse rounded-none bg-bg-deep" />
          </div>
          <div className="mt-3 h-6 w-3/4 animate-pulse rounded-none bg-bg-deep" />
          <div className="mt-2 h-3 w-full animate-pulse rounded-none bg-bg-deep" />
          <div className="mt-1 h-3 w-5/6 animate-pulse rounded-none bg-bg-deep" />
        </div>
        <div className="border border-l-0 border-hairline bg-bg-deep p-5">
          <div className="h-3 w-20 animate-pulse rounded-none bg-surface" />
          <div className="mt-2 h-8 w-16 animate-pulse rounded-none bg-surface" />
        </div>
      </section>

      <section className="grid gap-4 shell:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3 border border-hairline bg-surface p-5">
            <div className="h-4 w-full animate-pulse rounded-none bg-bg-deep" />
            <div className="h-3 w-2/3 animate-pulse rounded-none bg-bg-deep" />
          </div>
        ))}
      </section>
    </div>
  );
}
