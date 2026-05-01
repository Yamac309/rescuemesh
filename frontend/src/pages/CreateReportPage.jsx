import ReportForm from "../components/ReportForm";

export default function CreateReportPage({ mesh }) {
  return (
    <div className="form-page">
      <section className="section-header">
        <div>
          <p className="eyebrow">Device-first reporting</p>
          <h1>Create Report</h1>
        </div>
      </section>
      <ReportForm deviceId={mesh.deviceId} onSubmit={mesh.createLocalReport} />
    </div>
  );
}
