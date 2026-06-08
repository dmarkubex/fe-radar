import { PageFrame } from "@/components/layout/page-frame";

export default function Loading(): React.JSX.Element {
  return (
    <PageFrame size="wide">
      <div className="pb-4">
        <div className="h-2.5 w-32 animate-pulse rounded-none bg-bg-deep" />
        <div className="mt-2 h-8 w-48 animate-pulse rounded-none bg-bg-deep" />
        <div className="mt-2 h-3 w-full max-w-2xl animate-pulse rounded-none bg-bg-deep" />
      </div>

      <div className="grid grid-cols-5 gap-0 border border-border-strong">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2 border-r border-hairline bg-surface px-3 py-2.5 last:border-r-0">
            <div className="h-4 w-4 animate-pulse rounded-none bg-bg-deep" />
            <div className="h-3 w-16 animate-pulse rounded-none bg-bg-deep" />
            <div className="h-8 w-10 animate-pulse rounded-none bg-bg-deep" />
          </div>
        ))}
      </div>

      <section className="grid gap-0 sm:grid-cols-[1fr_280px]">
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
          <div className="mt-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-1.5 w-full animate-pulse rounded-none bg-surface" />
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3 border border-hairline bg-surface p-5">
            <div className="flex flex-wrap gap-2">
              <div className="h-4 w-10 animate-pulse rounded-none bg-bg-deep" />
              <div className="h-4 w-20 animate-pulse rounded-none bg-bg-deep" />
            </div>
            <div className="h-4 w-full animate-pulse rounded-none bg-bg-deep" />
            <div className="h-3 w-2/3 animate-pulse rounded-none bg-bg-deep" />
            <div className="mt-2 h-px w-full bg-hairline" />
            <div className="h-4 w-12 animate-pulse rounded-none bg-bg-deep" />
          </div>
        ))}
      </section>
    </PageFrame>
  );
}
