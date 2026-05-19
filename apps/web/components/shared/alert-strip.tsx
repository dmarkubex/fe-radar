export function alertStripClass(alertType: string | null, circle: string | null): string {
  if (alertType === "own") {
    return circle === "C1" ? "bg-danger" : circle === "C2" ? "bg-accent" : "bg-sunshine-700";
  }
  if (alertType === "safety") {
    return "bg-warn";
  }
  if (alertType === "policy") {
    return "bg-accent";
  }
  return circle === "C1" ? "bg-accent-flame" : circle === "C2" ? "bg-sunshine-700" : "bg-gold";
}

export function AlertStrip({ alertType, circle }: { alertType: string | null; circle: string | null }): React.JSX.Element {
  return <div className={`absolute inset-y-0 left-0 w-1.5 ${alertStripClass(alertType, circle)}`} aria-hidden="true" />;
}
