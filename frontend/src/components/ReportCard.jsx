import { CheckCircle2, EyeOff, Gauge, MapPin, ShieldCheck, Timer } from "lucide-react";
import { URGENCY_CLASS } from "../utils/constants";
import { calculateConfidence, getFreshness, getVerificationLabel } from "../utils/reportUtils";
import AiIncidentGuidance from "./AiIncidentGuidance";
import AgingBadge from "./AgingBadge";
import ConfidenceBadge from "./ConfidenceBadge";
import TrustSourceBadge from "./TrustSourceBadge";
import VerificationDetails from "./VerificationDetails";

export default function ReportCard({ report, deviceId, onConfirm, onResolve, onIgnore, allReports = [], compact = false }) {
  const alreadyConfirmed = report.confirmed_by_device_ids?.includes(deviceId);
  const freshness = getFreshness(report);
  const confidence = calculateConfidence(report, allReports);
  const verificationLabel = getVerificationLabel(report, allReports);
  const ageClass = `age-${freshness.label.toLowerCase()}`;

  function confirmIgnore() {
    const shouldIgnore = window.confirm(
      "Ignore this report on your device only? It will be hidden from your view, but other users will still be able to see it."
    );
    if (shouldIgnore) {
      onIgnore(report.report_id);
    }
  }

  return (
    <article className={`report-card ${compact ? "compact" : ""} ${ageClass}`}>
      <div className="report-card-header">
        <div>
          <p className="eyebrow">{report.category}</p>
          <h3>{report.title}</h3>
        </div>
        <div className="badge-stack">
          <span className={`badge ${URGENCY_CLASS[report.urgency]}`}>{report.urgency}</span>
          <AgingBadge report={report} />
        </div>
      </div>
      <div className="verification-row">
        <ConfidenceBadge report={report} allReports={allReports} />
        <TrustSourceBadge report={report} />
      </div>
      {!compact && <p className="description">{report.description}</p>}
      <div className="meta-grid">
        {report.locationName && (
          <span>
            <MapPin size={15} /> {report.locationName}
          </span>
        )}
        {report.locationAddress && (
          <span>
            <MapPin size={15} /> {report.locationAddress}
          </span>
        )}
        <span>
          <MapPin size={15} /> {Number(report.latitude).toFixed(4)}, {Number(report.longitude).toFixed(4)}
        </span>
        <span>
          <ShieldCheck size={15} /> {report.status === "Resolved" ? "Resolved" : verificationLabel}
        </span>
        <span>
          <CheckCircle2 size={15} /> {report.confirmation_count || 0} confirmations
        </span>
        <span>
          <Gauge size={15} /> Confidence: {confidence}%
        </span>
        <span>
          <Timer size={15} /> Age: {freshness.label}
        </span>
      </div>
      {!compact && <AiIncidentGuidance report={report} />}
      {!compact && <VerificationDetails report={report} />}
      <p className="timestamp">{new Date(report.timestamp).toLocaleString()}</p>
      <div className="card-actions">
        <button className="secondary" onClick={() => onConfirm(report.report_id)} disabled={alreadyConfirmed || report.status === "Resolved"}>
          {alreadyConfirmed ? "Confirmed by you" : "Confirm"}
        </button>
        <button className="secondary danger" onClick={() => onResolve(report.report_id)} disabled={report.status === "Resolved"}>
          Mark Resolved
        </button>
        {onIgnore && (
          <button className="secondary" onClick={confirmIgnore}>
            <EyeOff size={16} /> Ignore
          </button>
        )}
      </div>
    </article>
  );
}
