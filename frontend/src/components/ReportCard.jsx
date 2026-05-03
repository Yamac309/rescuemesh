import { CheckCircle2, EyeOff, Gauge, MapPin, ShieldCheck, Timer } from "lucide-react";
import { URGENCY_CLASS } from "../utils/constants";
import { calculateConfidence, getFreshness, getVerificationLabel } from "../utils/reportUtils";
import AiIncidentGuidance from "./AiIncidentGuidance";
import AgingBadge from "./AgingBadge";
import ConfidenceBadge from "./ConfidenceBadge";
import ReportComments from "./ReportComments";
import TrustSourceBadge from "./TrustSourceBadge";
import VerificationDetails from "./VerificationDetails";

export default function ReportCard({
  report,
  deviceId,
  onConfirm,
  onResolve,
  onIgnore,
  onAddComment,
  comments = [],
  allReports = [],
  compact = false
}) {
  const alreadyConfirmed = report.confirmed_by_device_ids?.includes(deviceId);
  const freshness = getFreshness(report);
  const confidence = calculateConfidence(report, allReports);
  const verificationLabel = getVerificationLabel(report, allReports);
  const ageClass = `age-${freshness.label.toLowerCase()}`;
  const isResolved = report.status === "Resolved";
  const isCritical = report.urgency === "Critical";

  function confirmIgnore() {
    const shouldIgnore = window.confirm(
      "Ignore this report on your device only? It will be hidden from your view, but other users will still be able to see it."
    );
    if (shouldIgnore) {
      onIgnore(report.report_id);
    }
  }

  return (
    <article className={`report-card ${compact ? "compact" : ""} ${ageClass}${isResolved ? " resolved" : ""}`}>
      <div className="report-card-header">
        <div className="report-card-title">
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

      {!compact && report.description && (
        <p className="description">{report.description}</p>
      )}

      <div className="meta-grid">
        {report.locationName && (
          <span><MapPin size={13} /> {report.locationName}</span>
        )}
        {report.locationAddress && !report.locationName && (
          <span><MapPin size={13} /> {report.locationAddress}</span>
        )}
        <span>
          <MapPin size={13} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.75rem" }}>
            {Number(report.latitude).toFixed(4)}, {Number(report.longitude).toFixed(4)}
          </span>
        </span>
        <span><ShieldCheck size={13} /> {isResolved ? "Resolved" : verificationLabel}</span>
        <span><CheckCircle2 size={13} /> {report.confirmation_count || 0} confirmation{report.confirmation_count !== 1 ? "s" : ""}</span>
        <span><Gauge size={13} /> Confidence: {confidence}%</span>
        <span><Timer size={13} /> Age: {freshness.label}</span>
      </div>

      {!compact && <AiIncidentGuidance report={report} />}
      {!compact && <VerificationDetails report={report} />}
      {!compact && onAddComment && (
        <ReportComments
          report={report}
          comments={comments}
          deviceId={deviceId}
          onAddComment={onAddComment}
        />
      )}

      <div className="report-card-footer">
        <span className="timestamp">{new Date(report.timestamp).toLocaleString()}</span>
        <div className="card-actions">
          <button
            className="secondary"
            onClick={() => onConfirm(report.report_id)}
            disabled={alreadyConfirmed || isResolved}
          >
            {alreadyConfirmed ? "Confirmed" : "Confirm"}
          </button>
          <button
            className="secondary danger"
            onClick={() => onResolve(report.report_id)}
            disabled={isResolved}
          >
            {isResolved ? "Resolved" : "Resolve"}
          </button>
          {onIgnore && (
            <button className="secondary" onClick={confirmIgnore}>
              <EyeOff size={14} /> Ignore
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
