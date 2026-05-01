import { Download, RefreshCw, Siren, Trash2 } from "lucide-react";
import NodeStatusCard from "../components/NodeStatusCard";
import ReportCard from "../components/ReportCard";
import { makeDemoReports } from "../utils/demoData";
import { downloadFile, toCsv } from "../utils/reportUtils";

export default function Dashboard({ mesh }) {
  const highPriority = mesh.reports.filter((report) => ["High", "Critical"].includes(report.urgency) && report.status !== "Resolved");
  const openReports = mesh.reports.filter((report) => report.status !== "Resolved");

  async function seedDemoData() {
    const demoReports = makeDemoReports(mesh.deviceId);
    for (const report of demoReports) {
      await mesh.createLocalReport(report);
    }
  }

  function exportJson() {
    downloadFile("rescuemesh-incident-log.json", JSON.stringify(mesh.reports, null, 2), "application/json");
  }

  function exportCsv() {
    downloadFile("rescuemesh-incident-log.csv", toCsv(mesh.reports), "text/csv");
  }

  function clearAllReports() {
    const confirmed = window.confirm("Clear all reports from this browser and the shared RescueMesh Node?");
    if (confirmed) {
      mesh.clearAllReports();
    }
  }

  return (
    <div className="page-grid">
      <section className="hero-band">
        <div>
          <p className="eyebrow">Offline-first emergency coordination</p>
          <h1>RescueMesh</h1>
          <p>
            Create incident reports on this device, keep working without internet, and sync with any local RescueMesh Node available on the same Wi-Fi/LAN.
          </p>
        </div>
        <div className="hero-actions">
          <button className="primary" onClick={mesh.syncNow}>
            <RefreshCw size={18} /> Sync Now
          </button>
          <button className="secondary" onClick={seedDemoData}>
            <Siren size={18} /> Load Demo Data
          </button>
          <button className="secondary danger" onClick={mesh.removeDemoReports}>
            <Trash2 size={18} /> Remove Demo Data
          </button>
          <button className="secondary danger" onClick={clearAllReports} disabled={!mesh.reports.length}>
            <Trash2 size={18} /> Clear All Reports
          </button>
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
          <strong>{mesh.backendOnline ? "Online" : "Offline"}</strong>
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
          <ReportCard key={report.report_id} report={report} deviceId={mesh.deviceId} onConfirm={mesh.confirmLocalReport} onResolve={mesh.resolveLocalReport} />
        ))}
        {!mesh.reports.length && <p className="empty-state">No reports yet. Create one or load demo data to test sync.</p>}
      </div>
    </div>
  );
}
