import { alertStripClass } from "./alert-meta";

export {
  alertStripClass,
  alertTypeBadgeClass,
  alertTypeLabel,
} from "./alert-meta";

export function AlertStrip({ alertType, circle }: { alertType: string | null; circle: string | null }): React.JSX.Element {
  return <div className={`absolute inset-y-0 left-0 w-1.5 ${alertStripClass(alertType, circle)}`} aria-hidden="true" />;
}
