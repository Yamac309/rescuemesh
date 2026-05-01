import { RefreshCw } from "lucide-react";
import NodeStatusCard from "../components/NodeStatusCard";

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
      <section className="info-panel">
        <h2>Local Network Node Mode</h2>
        <p>
          The FastAPI backend acts as a RescueMesh Node for this MVP. Browsers on the same local network can point to this node, exchange report IDs, upload missing reports,
          receive missing reports, and get WebSocket broadcasts when another client adds or updates an incident.
        </p>
      </section>
    </div>
  );
}
