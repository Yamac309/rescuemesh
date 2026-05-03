import { Download, RefreshCw, Siren, Trash2 } from "lucide-react";
import { useState } from "react";
import NodeStatusCard from "../components/NodeStatusCard";
import ReportCard from "../components/ReportCard";
import { makeDemoReports } from "../utils/demoData";
import { downloadFile, sourceTrustLabel, toCsv } from "../utils/reportUtils";

export default function Dashboard({ mesh }) {
  const [busyAction, setBusyAction] = useState(null);
  const highPriority = mesh.reports.filter(
    (r) => ["High", "Critical"].includes(r.urgency) && r.status !== "Resolved"
  );
  const openReports = mesh.reports.filter((r) => r.status !== "Resolved");
  const resolvedReports = mesh.reports.filter((r) => r.status === "Resolved");
  const showDevelopmentActions = import.meta.env.DEV;
  const controlsBusy = Boolean(busyAction);

  async function runAction(actionName, action) {
    if (busyAction) return;
    setBusyAction(actionName);
    try {
      await action();
    } finally {
      setBusyAction(null);
    }
  }

  async function seedDemoData() {
    await runAction("load-demo", async () => {
      await mesh.removeDemoReports();
      await mesh.createLocalReports(makeDemoReports(mesh.deviceId));
    });
  }

  function exportJson() {
    const safeReports = mesh.reports.map(({ device_id, deviceId, ...report }) => ({
      ...report,
      anonymousDevice: "hidden",
      sourceTrustLabel: sourceTrustLabel(report),
    }));
    downloadFile(
      "rescuemesh-incident-log.json",
      JSON.stringify(safeReports, null, 2),
      "application/json"
    );
  }

  function exportCsv() {
    downloadFile("rescuemesh-incident-log.csv", toCsv(mesh.reports), "text/csv");
  }

  function clearAllReports() {
    const confirmed = window.confirm(
      "Clear all reports from this browser and the shared RescueMesh Node?"
    );
    if (confirmed) {
      runAction("clear-all", mesh.clearAllReports);
    }
  }

  return (
    <div className="page-grid">
      {/* Page header - compact, operational */}
      <section className="section-header">
        <div>
          <p className="eyebrow">Active response node</p>
          <h1>Dashboard</h1>
        </div>
        <div className="button-row">
          <button className="secondary" onClick={exportJson}>
            <Download size={16} /> JSON
          </button>
          <button className="secondary" onClick={exportCsv}>
            <Download size={16} /> CSV
          </button>
        </div>
      </section>

      {/* Dev/demo controls - shown only in dev mode */}
      {showDevelopmentActions && (
        <div className="dev-controls">
          <span className="dev-label">DEV</span>
          <button className="secondary" onClick={seedDemoData} disabled={controlsBusy}>
            <Siren size={15} /> {busyAction === "load-demo" ? "Loading..." : "Load Demo Data"}
          </button>
          <button
            className="secondary danger"
            onClick={() => runAction("remove-demo", mesh.removeDemoReports)}
            disabled={controlsBusy}
          >
            <Trash2 size={15} /> {busyAction === "remove-demo" ? "Removing..." : "Remove Demo"}
          </button>
          <button
            className="secondary danger"
            onClick={clearAllReports}
            disabled={controlsBusy || !mesh.reports.length}
          >
            <Trash2 size={15} /> {busyAction === "clear-all" ? "Clearing..." : "Clear All"}
          </button>
          <div className="demo-time-control">
            <label>
              Demo Time Offset: +{mesh.demoTimeOffsetHours}h
              <input
                type="range"
                min="0"
                max="72"
                step="1"
                value={mesh.demoTimeOffsetHours}
                onChange={(e) => mesh.setDemoTimeOffsetHours(e.target.value)}
              />
            </label>
            <button
              className="secondary"
              onClick={() => mesh.setDemoTimeOffsetHours(0)}
              disabled={mesh.demoTimeOffsetHours === 0}
            >
              <RefreshCw size={14} /> Reset
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="stats-row">
        <div className="stat">
          <span>Total Reports</span>
          <strong>{mesh.reports.length}</strong>
        </div>
        <div className="stat">
          <span>Open</span>
          <strong>{openReports.length}</strong>
        </div>
        <div className="stat stat-alert">
          <span>High Priority</span>
          <strong>{highPriority.length}</strong>
        </div>
        <div className="stat stat-resolved">
          <span>Resolved</span>
          <strong>{resolvedReports.length}</strong>
        </div>
      </div>

      <NodeStatusCard {...mesh} />

      {/* Latest Reports */}
      <section className="section-header">
        <div>
          <p className="eyebrow">Incident Log</p>
          <h2>Latest Reports</h2>
        </div>
      </section>

      <div className="report-grid">
        {mesh.reports.slice(0, 6).map((report) => (
          <ReportCard
            key={report.report_id}
            report={report}
            deviceId={mesh.deviceId}
            onConfirm={mesh.confirmLocalReport}
            onResolve={mesh.resolveLocalReport}
            onIgnore={mesh.ignoreLocalReport}
            onAddComment={mesh.addCommentToReport}
            comments={mesh.commentsByReportId[report.report_id] || []}
            allReports={mesh.reports}
          />
        ))}
        {!mesh.reports.length && (
          <p className="empty-state">No reports yet. Create one or load demo data to test sync.</p>
        )}
      </div>
    </div>
  );
}
