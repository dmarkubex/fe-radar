export function PageHeader({
  eyebrow,
  title,
  description,
  variant = "default",
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  variant?: "default" | "compact" | "report";
}) {
  const paddingBottom =
    variant === "compact" ? "pb-2" : variant === "report" ? "pb-6" : "pb-4";

  return (
    <header className={paddingBottom}>
      {eyebrow ? (
        <p className="font-mono text-[10px] font-medium uppercase tracking-[1.4px] text-fg-soft">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="mt-1 display-fluid font-semibold tracking-tight text-fg">
        {title}
      </h1>
      {description ? (
        <p className="mt-1 text-sm leading-relaxed text-fg-muted">
          {description}
        </p>
      ) : null}
    </header>
  );
}
