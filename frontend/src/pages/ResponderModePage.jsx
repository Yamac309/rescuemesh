import { useMemo, useState } from "react";
import ReportCard from "../components/ReportCard";
import ResponderActions from "../components/ResponderActions";
import { calculateConfidence, getVerificationLabel } from "../utils/reportUtils";

const RESPONDER_FILTERS = [
  "Needs Review",
  "Critical",
  "Low Trust",
  "Unverified",
  "Likely Verified",
  "Verified",
  "Resolved",
  "Suspicious",
];

function matchesFilter(report, filter, reports) {
  const label = getVerificationLabel(report, reports);
  const confidence = calculateConfidence(report, reports);
  if (filter === "All") return true;
  if (filter === "Needs Review") return report.status === "Needs Review";
  if (filter === "Critical") return report.urgency === "Critical";
  if (filter === "Low Trust") return label === "Low Trust" || confidence < 30;
  if (filter === "Suspicious") return report.verificationSignals?.suspiciousDeviceActivity;
  if (filter === "Resolved") return report.status === "Resolved";
  return label === filter;
}

export default function ResponderModePage({ mesh }) {
  const [filter, setFilter] = useState("Needs Review");

  const filteredReports = useMemo(
    () => mesh.reports.filter((r) => matchesFilter(r, filter, mesh.reports)),
    [filter, mesh.reports]
  );

  return (
    <div className="page-grid">
      <section className="section-header">
        <div>
          <p className="eyebrow">Responder review</p>
          <h1>Responder Mode</h1>
        </div>
        <span className="responder-queue-count">
          {filteredReports.length} in queue
        </span>
      </section>

      <div className="filters responder-filter-row">
        <label>
          Review queue
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="All">All reports</option>
            {RESPONDER_FILTERS.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="responder-list">
        {filteredReports.map((report) => (
          <div className="responder-review" key={report.report_id}>
            <ReportCard
              report={report}
              deviceId={mesh.deviceId}
              onConfirm={mesh.confirmLocalReport}
              onResolve={mesh.resolveLocalReport}
              onIgnore={mesh.ignoreLocalReport}
              onAddComment={mesh.addCommentToReport}
              comments={mesh.commentsByReportId[report.report_id] || []}
              allReports={mesh.reports}
            />
            <ResponderActions
              report={report}
              onVerify={mesh.responderVerifyLocalReport}
              onReject={mesh.responderRejectLocalReport}
              onResolve={mesh.resolveLocalReport}
              onNote={mesh.addResponderNoteToReport}
            />
          </div>
        ))}
        {!filteredReports.length && (
          <p className="empty-state">No reports match this filter.</p>
        )}
      </div>
    </div>
  );
}
