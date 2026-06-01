export function PageFrame({
  children,
  size = "wide",
}: {
  children: React.ReactNode;
  size?: "wide" | "full";
}) {
  return (
    <main
      className={`mx-auto flex min-h-screen w-full ${size === "full" ? "max-w-7xl" : "max-w-[1200px]"} flex-col gap-5 pad-fluid font-body text-fg`}
    >
      {children}
    </main>
  );
}
