import { URGENCY_CLASS } from "../utils/constants";

export default function TimelineItem({ report }) {
  return (
    <article className="timeline-item">
      <time>{new Date(report.timestamp).toLocaleString()}</time>
      <div>
        <p className="eyebrow">{report.category}</p>
        <h3>{report.title}</h3>
        <div className="timeline-meta">
          <span className={`badge ${URGENCY_CLASS[report.urgency]}`}>{report.urgency}</span>
          <span>{report.status}</span>
          <span>{report.confirmation_count || 0} confirmations</span>
        </div>
      </div>
    </article>
  );
}
