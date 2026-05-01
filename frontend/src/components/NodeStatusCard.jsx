import { Activity, Database, RadioTower, UsersRound } from "lucide-react";

export default function NodeStatusCard({ nodeStatus, backendOnline, lastSyncTime, syncStatus }) {
  const status = nodeStatus || {};

  return (
    <section className="node-card">
      <div className="node-card-header">
        <RadioTower size={26} />
        <div>
          <p className="eyebrow">Local Network Node</p>
          <h2>{status.node_name || "RescueMesh Local Node"}</h2>
        </div>
      </div>
      <div className="status-grid">
        <div>
          <Activity size={20} />
          <span>Backend Health</span>
          <strong>{backendOnline ? status.backend_health || "ok" : "offline"}</strong>
        </div>
        <div>
          <UsersRound size={20} />
          <span>Connected Clients</span>
          <strong>{status.connected_clients ?? 0}</strong>
        </div>
        <div>
          <Database size={20} />
          <span>Total Reports</span>
          <strong>{status.total_reports ?? 0}</strong>
        </div>
        <div>
          <Activity size={20} />
          <span>Last Sync</span>
          <strong>{lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString() : "Not yet"}</strong>
        </div>
      </div>
      <p className="sync-line">{syncStatus}</p>
    </section>
  );
}
