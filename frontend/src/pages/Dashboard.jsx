import { Download, Siren, Trash2 } from "lucide-react";
import { useState } from "react";
import NodeStatusCard from "../components/NodeStatusCard";
import ReportCard from "../components/ReportCard";
import { makeDemoReports } from "../utils/demoData";
import { downloadFile, sourceTrustLabel, toCsv } from "../utils/reportUtils";

export default function Dashboard({ mesh }) {
  const [busyAction, setBusyAction] = useState(null);
  const highPriority = mesh.reports.filter((report) => ["High", "Critical"].includes(report.urgency) && report.status !== "Resolved");
  const openReports = mesh.reports.filter((report) => report.status !== "Resolved");
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
      sourceTrustLabel: sourceTrustLabel(report)
    }));
    downloadFile("rescuemesh-incident-log.json", JSON.stringify(safeReports, null, 2), "application/json");
  }

  function exportCsv() {
    downloadFile("rescuemesh-incident-log.csv", toCsv(mesh.reports), "text/csv");
  }

  function clearAllReports() {
    const confirmed = window.confirm("Clear all reports from this browser and the shared RescueMesh Node?");
    if (confirmed) {
      runAction("clear-all", mesh.clearAllReports);
    }
  }

  return (
    <div className="page-grid">
      <section className="hero-band">
        <div>
          <p className="eyebrow">Online emergency coordination</p>
          <h1>RescueMesh</h1>
          <p>
            Create incident reports, verify information with multiple signals, and share updates through the active RescueMesh response node.
          </p>
        </div>
        <div className="hero-actions">
          {showDevelopmentActions && (
            <>
              <button className="secondary" onClick={seedDemoData} disabled={controlsBusy}>
                <Siren size={18} /> {busyAction === "load-demo" ? "Loading..." : "Load Demo Data"}
              </button>
              <button className="secondary danger" onClick={() => runAction("remove-demo", mesh.removeDemoReports)} disabled={controlsBusy}>
                <Trash2 size={18} /> {busyAction === "remove-demo" ? "Removing..." : "Remove Demo Data"}
              </button>
              <button className="secondary danger" onClick={clearAllReports} disabled={controlsBusy || !mesh.reports.length}>
                <Trash2 size={18} /> {busyAction === "clear-all" ? "Clearing..." : "Clear All Reports"}
              </button>
              <div className="demo-time-control">
                <label>
                  Demo Time: +{mesh.demoTimeOffsetHours}h
                  <input
                    type="range"
                    min="0"
                    max="72"
                    step="1"
                    value={mesh.demoTimeOffsetHours}
                    onChange={(event) => mesh.setDemoTimeOffsetHours(event.target.value)}
                  />
                </label>
                <button className="secondary" onClick={() => mesh.setDemoTimeOffsetHours(0)} disabled={mesh.demoTimeOffsetHours === 0}>
                  Reset Time
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      <div className="stats-row">
        <div className="stat">
          <span>Total reports</span>
          <strong>{mesh.reports.length}</strong>
        </div>
        <div className="stat">
          <span>Open reports</span>
          <strong>{openReports.length}</strong>
        </div>
        <div className="stat">
          <span>High priority</span>
          <strong>{highPriority.length}</strong>
        </div>
        <div className="stat">
          <span>Node</span>
          <strong>Online</strong>
        </div>
      </div>

      <NodeStatusCard {...mesh} />

      <section className="section-header">
        <div>
          <p className="eyebrow">Incident Log</p>
          <h2>Latest Reports</h2>
        </div>
        <div className="button-row">
          <button className="secondary" onClick={exportJson}>
            <Download size={18} /> JSON
          </button>
          <button className="secondary" onClick={exportCsv}>
            <Download size={18} /> CSV
          </button>
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
            allReports={mesh.reports}
          />
        ))}
        {!mesh.reports.length && <p className="empty-state">No reports yet. Create one or load demo data to test sync.</p>}
      </div>
    </div>
  );
}
