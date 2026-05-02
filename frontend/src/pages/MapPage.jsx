import { useMemo, useState } from "react";
import ReportCard from "../components/ReportCard";
import ReportFilters from "../components/ReportFilters";
import ReportMap from "../components/ReportMap";

function applyFilters(reports, filters) {
  return reports.filter((report) => {
    return (
      (filters.category === "All" || report.category === filters.category) &&
      (filters.urgency === "All" || report.urgency === filters.urgency) &&
      (filters.status === "All" || report.status === filters.status)
    );
  });
}

export default function MapPage({ mesh }) {
  const [filters, setFilters] = useState({ category: "All", urgency: "All", status: "All" });
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
        <ReportMap reports={filteredReports} />
        <aside className="map-list">
          {filteredReports.map((report) => (
            <ReportCard
              key={report.report_id}
              report={report}
              deviceId={mesh.deviceId}
              onConfirm={mesh.confirmLocalReport}
              onResolve={mesh.resolveLocalReport}
              onIgnore={mesh.ignoreLocalReport}
              compact
            />
          ))}
          {!filteredReports.length && <p className="empty-state">No reports match these filters.</p>}
        </aside>
      </div>
    </div>
  );
}
