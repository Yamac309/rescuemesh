import { URGENCY_CLASS } from "../utils/constants";
import { calculateConfidence, getFreshness, getVerificationLabel } from "../utils/reportUtils";

export default function TimelineItem({ report, allReports = [] }) {
  const freshness = getFreshness(report);
  const confidence = calculateConfidence(report, allReports);
  const verificationLabel = getVerificationLabel(report, allReports);
  const ageClass = `age-${freshness.label.toLowerCase()}`;

  return (
    <article className={`timeline-item ${ageClass}`}>
      <time>{new Date(report.timestamp).toLocaleString()}</time>
      <div>
        <p className="eyebrow">{report.category}</p>
        <h3>{report.title}</h3>
        <div className="timeline-meta">
          <span className={`badge ${URGENCY_CLASS[report.urgency]}`}>{report.urgency}</span>
          <span className={`freshness-pill ${freshness.className}`}>{freshness.label}</span>
          <span>{report.status === "Resolved" ? "Resolved" : verificationLabel}</span>
          <span>Confidence: {confidence}%</span>
          <span>{report.confirmation_count || 0} confirmations</span>
          <span>{report.responderVerified ? "Responder verified" : report.responderRejected ? "Responder rejected" : "No responder review"}</span>
        </div>
      </div>
    </article>
  );
}
