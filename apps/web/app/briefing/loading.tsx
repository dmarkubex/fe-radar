export default function Loading(): React.JSX.Element {
  return (
    <div className="bg-bg">
      <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-3.5 md:px-10">
        <div className="h-3 w-20 animate-pulse bg-bg-deep" />
        <div className="flex gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-8 w-12 animate-pulse border border-border bg-surface" />
          ))}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1100px] px-6 py-8 md:px-10">
        <div className="mb-8 space-y-3">
          <div className="h-2.5 w-32 animate-pulse bg-bg-deep" />
          <div className="h-8 w-64 max-w-full animate-pulse bg-bg-deep" />
          <div className="h-3 w-48 animate-pulse bg-bg-deep" />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-[360px] animate-pulse border border-border bg-surface" />
          ))}
        </div>
        <div className="mt-6 h-32 animate-pulse border border-border bg-surface" />
      </div>
    </div>
  );
}
