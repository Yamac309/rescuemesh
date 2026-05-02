import { calculateConfidence, getVerificationLabel } from "../utils/reportUtils";

export default function ConfidenceBadge({ report, allReports = [] }) {
  const score = calculateConfidence(report, allReports);
  const label = getVerificationLabel(report, allReports);
  return (
    <span className={`confidence-badge confidence-${label.toLowerCase().replaceAll(" ", "-")}`}>
      {label} · {score}%
    </span>
  );
}
