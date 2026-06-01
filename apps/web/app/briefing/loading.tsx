import { PageFrame } from "@/components/layout/page-frame";

export default function Loading(): React.JSX.Element {
  return (
    <PageFrame size="wide">
      <div className="pb-4">
        <div className="h-2.5 w-28 animate-pulse rounded-none bg-bg-deep" />
        <div className="mt-2 h-8 w-56 animate-pulse rounded-none bg-bg-deep" />
        <div className="mt-2 h-3 w-full max-w-2xl animate-pulse rounded-none bg-bg-deep" />
      </div>

      <div className="flex flex-col divide-y divide-hairline border border-border">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 bg-surface px-5 py-4">
            <div className="flex min-w-0 items-center gap-4">
              <div className="h-9 w-9 flex-shrink-0 animate-pulse rounded-none border border-border bg-bg-deep" />
              <div className="min-w-0 space-y-2">
                <div className="h-4 w-48 animate-pulse rounded-none bg-bg-deep" />
                <div className="h-2.5 w-32 animate-pulse rounded-none bg-bg-deep" />
              </div>
            </div>
            <div className="h-3 w-16 flex-shrink-0 animate-pulse rounded-none bg-bg-deep" />
          </div>
        ))}
      </div>
    </PageFrame>
  );
}
