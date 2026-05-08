import { useMemo, useState } from "react";
import { RefreshCw, RadioTower } from "lucide-react";
import LiveIncidentCard from "../components/LiveIncidentCard";
import ReportCard from "../components/ReportCard";
import ReportFilters from "../components/ReportFilters";
import ReportMap from "../components/ReportMap";
import { useLiveIncidents } from "../hooks/useLiveIncidents";
import { isInsideUsaBounds } from "../utils/constants";
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

const DEFAULT_FILTERS = {
  category: "All",
  urgency: "All",
  status: "All",
  verification: "All",
  confidence: "All",
  aging: "All",
  needsReview: false,
  suspicious: false,
  responderVerified: false,
  stale: false,
};

export default function MapPage({ mesh }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [showLiveIncidents, setShowLiveIncidents] = useState(true);
  const liveIncidents = useLiveIncidents({ enabled: showLiveIncidents, days: 7, limit: 200 });
  const usaReports = useMemo(() => mesh.reports.filter(isInsideUsaBounds), [mesh.reports]);

  const filteredReports = useMemo(
    () => applyFilters(usaReports, filters),
    [usaReports, filters]
  );
  const visibleLiveIncidents = showLiveIncidents ? liveIncidents.incidents.filter(isInsideUsaBounds) : [];

  return (
    <div className="page-grid">
      <section className="section-header">
        <div>
          <p className="eyebrow">Shared operating picture</p>
          <h1>Map</h1>
        </div>
        <span className="map-report-count">
          {filteredReports.length} of {usaReports.length} U.S. reports · {visibleLiveIncidents.length} live
        </span>
      </section>

      <section className="live-incident-controls">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={showLiveIncidents}
            onChange={(event) => setShowLiveIncidents(event.target.checked)}
          />
          <span><RadioTower size={16} /> Live incidents from last 7 days</span>
        </label>
        <button
          type="button"
          className="secondary"
          onClick={liveIncidents.refresh}
          disabled={!showLiveIncidents || liveIncidents.refreshing}
        >
          <RefreshCw size={16} /> {liveIncidents.refreshing ? "Refreshing" : "Refresh Live"}
        </button>
        <span className={`live-incident-status ${liveIncidents.error ? "warning" : ""}`}>
          {showLiveIncidents
            ? liveIncidents.error || (liveIncidents.loading ? "Loading live incidents..." : liveIncidents.status?.available ? "MongoDB Atlas live feed connected" : "MongoDB Atlas live feed not configured")
            : "Live layer hidden"}
        </span>
      </section>

      <ReportFilters filters={filters} onChange={setFilters} />

      <div className="map-layout">
        <ReportMap reports={filteredReports} allReports={usaReports} liveIncidents={visibleLiveIncidents} />

        <aside className="map-list">
          {visibleLiveIncidents.map((incident) => (
            <LiveIncidentCard key={incident.incidentId} incident={incident} />
          ))}
          {filteredReports.map((report) => (
            <ReportCard
              key={report.report_id}
              report={report}
              deviceId={mesh.deviceId}
              onConfirm={mesh.confirmLocalReport}
              onResolve={mesh.resolveLocalReport}
              onIgnore={mesh.ignoreLocalReport}
              onAddComment={mesh.addCommentToReport}
              comments={mesh.commentsByReportId[report.report_id] || []}
              allReports={usaReports}
              compact
            />
          ))}
          {!filteredReports.length && !visibleLiveIncidents.length && (
            <p className="empty-state">No U.S. reports match these filters.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
