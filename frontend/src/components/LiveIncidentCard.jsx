import { ExternalLink, MapPin, RadioTower } from "lucide-react";
import AgingBadge from "./AgingBadge";

export default function LiveIncidentCard({ incident }) {
  return (
    <article className="live-incident-card">
      <div className="live-incident-header">
        <div>
          <p className="eyebrow">Live incident</p>
          <h3>{incident.title}</h3>
        </div>
        <span className={`badge urgency-${incident.urgency.toLowerCase()}`}>{incident.urgency}</span>
      </div>

      {incident.description && <p className="description">{incident.description}</p>}

      <div className="meta-grid">
        <span><RadioTower size={14} /> {incident.source}</span>
        <span><MapPin size={14} /> {incident.locationName || incident.locationAddress || "Mapped incident"}</span>
        <span><MapPin size={14} /> {incident.latitude.toFixed(4)}, {incident.longitude.toFixed(4)}</span>
      </div>

      <div className="live-incident-footer">
        <AgingBadge report={incident} />
        <time className="timestamp">{new Date(incident.timestamp).toLocaleString()}</time>
      </div>

      {incident.sourceUrl && (
        <a className="live-incident-link" href={incident.sourceUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={14} /> Source
        </a>
      )}
    </article>
  );
}
