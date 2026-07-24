export default function Loading(): React.JSX.Element {
  return (
    <div>
      <header className="border-b border-hairline pad-fluid-x py-5">
        <div className="h-2.5 w-28 animate-pulse rounded-none bg-bg-deep" />
        <div className="mt-2 h-8 w-80 max-w-full animate-pulse rounded-none bg-bg-deep" />
        <div className="mt-2 h-3 w-full max-w-3xl animate-pulse rounded-none bg-bg-deep" />
      </header>

      <div className="pad-fluid-x py-5">
        <div className="mb-4 grid grid-cols-3 gap-px border border-border bg-border max-[720px]:grid-cols-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3.5 bg-surface p-4">
              <div className="h-8 w-10 animate-pulse rounded-none bg-bg-deep" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-24 animate-pulse rounded-none bg-bg-deep" />
                <div className="h-2.5 w-32 animate-pulse rounded-none bg-bg-deep" />
              </div>
            </div>
          ))}
        </div>

        <div className="my-5 flex items-center gap-3.5">
          <div className="h-5 w-32 animate-pulse rounded-none bg-bg-deep" />
          <div className="h-px flex-1 bg-border" />
        </div>

        {Array.from({ length: 4 }).map((_, i) => (
          <article key={i} className="mb-2.5 grid grid-cols-[1fr_220px] items-start gap-7 border border-border bg-surface px-5 py-[18px] max-[1100px]:grid-cols-1">
            <div className="min-w-0">
              <div className="mb-2.5 flex flex-wrap gap-2">
                <div className="h-5 w-14 animate-pulse rounded-none bg-bg-deep" />
                <div className="h-5 w-20 animate-pulse rounded-none bg-bg-deep" />
                <div className="h-5 w-12 animate-pulse rounded-none bg-bg-deep" />
              </div>
              <div className="mb-2 h-6 w-3/4 animate-pulse rounded-none bg-bg-deep" />
              <div className="h-3 w-full animate-pulse rounded-none bg-bg-deep" />
              <div className="mt-1 h-3 w-2/3 animate-pulse rounded-none bg-bg-deep" />
            </div>
            <aside className="flex min-h-full flex-col gap-3 border-l border-hairline pl-6 max-[1100px]:border-l-0 max-[1100px]:border-t max-[1100px]:pl-0 max-[1100px]:pt-4">
              <div className="flex items-baseline justify-between border-b border-hairline pb-2.5">
                <div className="h-3 w-16 animate-pulse rounded-none bg-bg-deep" />
                <div className="h-8 w-12 animate-pulse rounded-none bg-bg-deep" />
              </div>
              <div className="h-3 w-full animate-pulse rounded-none bg-bg-deep" />
              <div className="h-3 w-2/3 animate-pulse rounded-none bg-bg-deep" />
            </aside>
          </article>
        ))}
      </div>
    </div>
  );
}
