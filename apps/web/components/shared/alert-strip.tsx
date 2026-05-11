export function alertStripClass(alertType: string | null, circle: string | null): string {
  if (alertType === "own") {
    return circle === "C1" ? "bg-red-600" : circle === "C2" ? "bg-orange-500" : "bg-yellow-500";
  }
  if (alertType === "safety") {
    return "bg-zinc-500";
  }
  if (alertType === "policy") {
    return "bg-blue-600";
  }
  return circle === "C1" ? "bg-red-300" : circle === "C2" ? "bg-orange-300" : "bg-zinc-300";
}

export function AlertStrip({ alertType, circle }: { alertType: string | null; circle: string | null }): React.JSX.Element {
  return <div className={`absolute inset-y-0 left-0 w-1.5 ${alertStripClass(alertType, circle)}`} aria-hidden="true" />;
}
