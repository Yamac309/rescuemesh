import { sourceTrustLabel } from "../utils/reportUtils";

export default function TrustSourceBadge({ report }) {
  const label = sourceTrustLabel(report);
  return <span className={`trust-badge trust-${label.toLowerCase().replaceAll(" ", "-")}`}>{label}</span>;
}
