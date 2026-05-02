import { CheckCircle2, EyeOff, MapPin, ShieldCheck } from "lucide-react";
import { URGENCY_CLASS } from "../utils/constants";

export default function ReportCard({ report, deviceId, onConfirm, onResolve, onIgnore, compact = false }) {
  const alreadyConfirmed = report.confirmed_by_device_ids?.includes(deviceId);

  function confirmIgnore() {
    const shouldIgnore = window.confirm(
      "Ignore this report on your device only? It will be hidden from your view, but other users will still be able to see it."
    );
    if (shouldIgnore) {
      onIgnore(report.report_id);
    }
  }

  return (
    <article className={`report-card ${compact ? "compact" : ""}`}>
      <div className="report-card-header">
        <div>
          <p className="eyebrow">{report.category}</p>
          <h3>{report.title}</h3>
        </div>
        <span className={`badge ${URGENCY_CLASS[report.urgency]}`}>{report.urgency}</span>
      </div>
      {!compact && <p className="description">{report.description}</p>}
      <div className="meta-grid">
        <span>
          <MapPin size={15} /> {Number(report.latitude).toFixed(4)}, {Number(report.longitude).toFixed(4)}
        </span>
        <span>
          <ShieldCheck size={15} /> {report.status}
        </span>
        <span>
          <CheckCircle2 size={15} /> {report.confirmation_count || 0} confirmations
        </span>
      </div>
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
