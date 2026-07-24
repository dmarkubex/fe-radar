export function PageFrame({
  children,
  size = "wide",
}: {
  children: React.ReactNode;
  size?: "wide" | "full";
}) {
  return (
    <div
      className={`mx-auto flex min-h-0 w-full ${size === "full" ? "max-w-7xl" : "max-w-[1200px]"} flex-col gap-5 pad-fluid font-body text-fg`}
    >
      {children}
    </div>
  );
}
