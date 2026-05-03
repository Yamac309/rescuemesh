import { useNavigate } from "react-router-dom";
import ReportForm from "../components/ReportForm";

export default function CreateReportPage({ mesh }) {
  const navigate = useNavigate();

  async function createReport(report) {
    const duplicate = await mesh.createLocalReport(report);
    navigate("/");
    return duplicate;
  }

  return (
    <div className="form-page">
      <section className="section-header">
        <div>
          <p className="eyebrow">Device-first reporting</p>
          <h1>Create Report</h1>
        </div>
      </section>
      <ReportForm deviceId={mesh.deviceId} reports={mesh.reports} onSubmit={createReport} />
    </div>
  );
}
