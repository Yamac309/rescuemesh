import { RefreshCw } from "lucide-react";
import NodeStatusCard from "../components/NodeStatusCard";
import SecurityAccessPanel from "../components/SecurityAccessPanel";

export default function NodeStatusPage({ mesh }) {
  return (
    <div className="page-grid">
      <section className="section-header">
        <div>
          <p className="eyebrow">RescueMesh Node</p>
          <h1>Node Status</h1>
        </div>
        <button className="primary" onClick={mesh.refreshNodeStatus}>
          <RefreshCw size={18} /> Refresh
        </button>
      </section>
      <NodeStatusCard {...mesh} />
      <SecurityAccessPanel />
      <section className="info-panel">
        <h2>Online Response Node</h2>
        <p>
          The FastAPI backend acts as the active RescueMesh response node for this MVP. Browsers connect to this node, exchange reports, and receive WebSocket broadcasts
          when another client adds or updates an incident.
        </p>
      </section>
    </div>
  );
}
