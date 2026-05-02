import { getFreshness } from "../utils/reportUtils";

export default function AgingBadge({ report }) {
  const freshness = getFreshness(report);
  return <span className={`freshness-pill ${freshness.className}`}>{freshness.label}</span>;
}
