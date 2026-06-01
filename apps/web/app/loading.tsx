import { PageFrame } from "@/components/layout/page-frame";

export default function Loading(): React.JSX.Element {
  return (
    <PageFrame size="wide">
      <div className="pb-4">
        <div className="h-2.5 w-32 animate-pulse rounded-none bg-bg-deep" />
        <div className="mt-2 h-8 w-64 animate-pulse rounded-none bg-bg-deep" />
        <div className="mt-2 h-3 w-full max-w-2xl animate-pulse rounded-none bg-bg-deep" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-none border border-hairline bg-surface px-4 py-3">
            <div className="h-2.5 w-12 animate-pulse rounded-none bg-bg-deep" />
            <div className="h-7 w-16 animate-pulse rounded-none bg-bg-deep" />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 w-24 animate-pulse rounded-none bg-bg-deep" />
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-0 border border-hairline bg-surface">
            <div className="w-1 animate-pulse bg-bg-deep" />
            <div className="flex-1 px-5 py-4">
              <div className="flex flex-wrap gap-2">
                <div className="h-4 w-12 animate-pulse rounded-none bg-bg-deep" />
                <div className="h-4 w-12 animate-pulse rounded-none bg-bg-deep" />
                <div className="h-4 w-28 animate-pulse rounded-none bg-bg-deep" />
              </div>
              <div className="mt-3 h-5 w-3/4 animate-pulse rounded-none bg-bg-deep" />
              <div className="mt-2 h-3 w-full animate-pulse rounded-none bg-bg-deep" />
              <div className="mt-1 h-3 w-2/3 animate-pulse rounded-none bg-bg-deep" />
            </div>
          </div>
        ))}
      </div>
    </PageFrame>
  );
}
