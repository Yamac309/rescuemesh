import { useMemo, useState } from "react";
import ReportCard from "../components/ReportCard";
import ReportFilters from "../components/ReportFilters";
import ReportMap from "../components/ReportMap";
import { calculateConfidence, getFreshness, getVerificationLabel } from "../utils/reportUtils";

function applyFilters(reports, filters) {
  return reports.filter((report) => {
    return (
      (filters.category === "All" || report.category === filters.category) &&
      (filters.urgency === "All" || report.urgency === filters.urgency) &&
      (filters.status === "All" || report.status === filters.status) &&
      (filters.verification === "All" || getVerificationLabel(report, reports) === filters.verification) &&
      (filters.aging === "All" || getFreshness(report).label === filters.aging) &&
      confidenceMatches(report, reports, filters.confidence) &&
      (!filters.needsReview || report.status === "Needs Review") &&
      (!filters.suspicious || report.verificationSignals?.suspiciousDeviceActivity) &&
      (!filters.responderVerified || report.responderVerified) &&
      (!filters.stale || getFreshness(report).label === "Stale")
    );
  });
}

function confidenceMatches(report, reports, range) {
  if (range === "All") return true;
  const [min, max] = range.split("-").map(Number);
  const score = calculateConfidence(report, reports);
  return score >= min && score <= max;
}

export default function MapPage({ mesh }) {
  const [filters, setFilters] = useState({
    category: "All",
    urgency: "All",
    status: "All",
    verification: "All",
    confidence: "All",
    aging: "All",
    needsReview: false,
    suspicious: false,
    responderVerified: false,
    stale: false
  });
  const filteredReports = useMemo(() => applyFilters(mesh.reports, filters), [mesh.reports, filters]);

  return (
    <div className="page-grid">
      <section className="section-header">
        <div>
          <p className="eyebrow">Shared operating picture</p>
          <h1>Emergency Map</h1>
        </div>
      </section>
      <ReportFilters filters={filters} onChange={setFilters} />
      <div className="map-layout">
        <ReportMap reports={filteredReports} allReports={mesh.reports} />
        <aside className="map-list">
          {filteredReports.map((report) => (
            <ReportCard
              key={report.report_id}
              report={report}
              deviceId={mesh.deviceId}
              onConfirm={mesh.confirmLocalReport}
              onResolve={mesh.resolveLocalReport}
              onIgnore={mesh.ignoreLocalReport}
              allReports={mesh.reports}
              compact
            />
          ))}
          {!filteredReports.length && <p className="empty-state">No reports match these filters.</p>}
        </aside>
      </div>
    </div>
  );
}
