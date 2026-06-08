import { PageFrame } from "@/components/layout/page-frame";

export default function Loading(): React.JSX.Element {
  return (
    <PageFrame size="wide">
      <div className="pb-4">
        <div className="h-2.5 w-28 animate-pulse rounded-none bg-bg-deep" />
        <div className="mt-2 h-8 w-40 animate-pulse rounded-none bg-bg-deep" />
        <div className="mt-2 h-3 w-full max-w-2xl animate-pulse rounded-none bg-bg-deep" />
      </div>

      <div className="h-11 w-full animate-pulse rounded-none bg-bg-deep" />

      <div className="flex items-center justify-between border-b border-border pb-2">
        <div className="h-3 w-32 animate-pulse rounded-none bg-bg-deep" />
        <div className="h-3 w-20 animate-pulse rounded-none bg-bg-deep" />
      </div>

      <div className="flex flex-col gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex gap-0 border border-hairline bg-surface">
            <div className="w-1 animate-pulse bg-bg-deep" />
            <div className="flex-1 px-5 py-4">
              <div className="flex flex-wrap gap-2">
                <div className="h-4 w-12 animate-pulse rounded-none bg-bg-deep" />
                <div className="h-4 w-28 animate-pulse rounded-none bg-bg-deep" />
              </div>
              <div className="mt-3 h-5 w-3/4 animate-pulse rounded-none bg-bg-deep" />
              <div className="mt-2 h-3 w-full animate-pulse rounded-none bg-bg-deep" />
            </div>
          </div>
        ))}
      </div>
    </PageFrame>
  );
}
