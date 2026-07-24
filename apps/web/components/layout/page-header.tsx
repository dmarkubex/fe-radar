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
        <p className="eyebrow">{eyebrow}</p>
      ) : null}
      <h1 className="mt-1 font-display display-fluid font-semibold text-fg">
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
