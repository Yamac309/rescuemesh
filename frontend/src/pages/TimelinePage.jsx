import TimelineItem from "../components/TimelineItem";
import { sortByOldest } from "../utils/reportUtils";

export default function TimelinePage({ reports }) {
  const timeline = sortByOldest(reports);

  return (
    <div className="page-grid">
      <section className="section-header">
        <div>
          <p className="eyebrow">Chronological incident feed</p>
          <h1>Emergency Timeline</h1>
        </div>
      </section>
      <div className="timeline">
        {timeline.map((report) => (
          <TimelineItem key={report.report_id} report={report} allReports={reports} />
        ))}
        {!timeline.length && <p className="empty-state">No timeline entries yet.</p>}
      </div>
    </div>
  );
}
