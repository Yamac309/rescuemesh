import { useState } from "react";
import { LocateFixed } from "lucide-react";
import { CATEGORIES, STATUSES, URGENCY_LEVELS } from "../utils/constants";
import { makeReportId } from "../utils/reportUtils";

const initialForm = {
  title: "",
  category: "Need Help",
  description: "",
  urgency: "Medium",
  latitude: "",
  longitude: "",
  status: "Unverified"
};

export default function ReportForm({ deviceId, onSubmit }) {
  const [form, setForm] = useState(initialForm);
  const [message, setMessage] = useState("");

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setMessage("Location is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        updateField("latitude", position.coords.latitude.toFixed(6));
        updateField("longitude", position.coords.longitude.toFixed(6));
        setMessage("Location filled from this device.");
      },
      () => setMessage("Unable to read device location. You can enter coordinates manually.")
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");

    const report = {
      report_id: makeReportId(deviceId),
      title: form.title.trim(),
      category: form.category,
      description: form.description.trim(),
      urgency: form.urgency,
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
      status: form.status,
      timestamp: new Date().toISOString(),
      device_id: deviceId,
      confirmation_count: 0,
      confirmed_by_device_ids: [],
      sync_state: "pending"
    };

    const duplicate = await onSubmit(report);
    setForm(initialForm);
    setMessage(
      duplicate
        ? `This may be a duplicate of an existing report: "${duplicate.title}". The report was still saved.`
        : "Report saved locally. It will sync when a RescueMesh Node is reachable."
    );
  }

  return (
    <form className="report-form" onSubmit={handleSubmit}>
      {message && <div className="notice">{message}</div>}
      <label>
        Title
        <input value={form.title} onChange={(event) => updateField("title", event.target.value)} required maxLength={120} />
      </label>
      <div className="form-grid">
        <label>
          Category
          <select value={form.category} onChange={(event) => updateField("category", event.target.value)}>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label>
          Urgency
          <select value={form.urgency} onChange={(event) => updateField("urgency", event.target.value)}>
            {URGENCY_LEVELS.map((urgency) => (
              <option key={urgency} value={urgency}>
                {urgency}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={form.status} onChange={(event) => updateField("status", event.target.value)}>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Description
        <textarea value={form.description} onChange={(event) => updateField("description", event.target.value)} rows={5} />
      </label>
      <div className="coordinate-row">
        <label>
          Latitude
          <input type="number" step="any" min="-90" max="90" value={form.latitude} onChange={(event) => updateField("latitude", event.target.value)} required />
        </label>
        <label>
          Longitude
          <input type="number" step="any" min="-180" max="180" value={form.longitude} onChange={(event) => updateField("longitude", event.target.value)} required />
        </label>
        <button type="button" className="icon-button" onClick={useCurrentLocation} title="Use current location">
          <LocateFixed size={20} />
        </button>
      </div>
      <button type="submit" className="primary">
        Save Emergency Report
      </button>
    </form>
  );
}
