import { useState } from "react";
import { LocateFixed } from "lucide-react";
import { CATEGORIES, STATUSES, URGENCY_LEVELS } from "../utils/constants";
import { findPossibleDuplicate, makeReportId } from "../utils/reportUtils";

const initialForm = {
  title: "",
  category: "Need Help",
  description: "",
  urgency: "Medium",
  latitude: "",
  longitude: "",
  status: "Unverified",
  photoEvidenceAttached: false
};

export default function ReportForm({ deviceId, reports = [], onSubmit }) {
  const [form, setForm] = useState(initialForm);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("info");

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setMessageTone("warning");
      setMessage("This browser does not support device location. Enter the incident coordinates manually.");
      return;
    }

    setMessageTone("info");
    setMessage("Requesting your real device location...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        updateField("latitude", position.coords.latitude.toFixed(6));
        updateField("longitude", position.coords.longitude.toFixed(6));
        setMessageTone("success");
        setMessage("Real device location filled from your browser.");
      },
      (error) => {
        const permissionDenied = error.code === error.PERMISSION_DENIED;
        setMessageTone("warning");
        setMessage(
          permissionDenied
            ? "Location permission was denied. Allow location access in the browser or enter coordinates manually."
            : "The browser could not get a real device location. Enter the incident coordinates manually."
        );
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000
      }
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setMessageTone("info");

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
      photo_evidence_attached: form.photoEvidenceAttached,
      confirmation_count: 0,
      confirmed_by_device_ids: [],
      sync_state: "pending"
    };

    const possibleDuplicate = findPossibleDuplicate(report, reports);
    if (possibleDuplicate) {
      const shouldContinue = window.confirm(
        `This looks similar to another report: "${possibleDuplicate.title}". Are you sure you want to create a new report?`
      );
      if (!shouldContinue) {
        setMessageTone("info");
        setMessage("Report was not saved. You can update the details or confirm the existing report instead.");
        return;
      }
    }

    const duplicate = await onSubmit(report);
    setForm(initialForm);
    setMessageTone(duplicate ? "warning" : "success");
    setMessage(
      duplicate
        ? `This may be a duplicate of an existing report: "${duplicate.title}". The report was still saved.`
        : "Report saved locally. It will sync when a RescueMesh Node is reachable."
    );
  }

  return (
    <form className="report-form" onSubmit={handleSubmit}>
      {message && <div className={`notice ${messageTone}`}>{message}</div>}
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
      <p className="field-help">Coordinates are the incident location. Use the location button only when the report is about where this device is right now.</p>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={form.photoEvidenceAttached}
          onChange={(event) => updateField("photoEvidenceAttached", event.target.checked)}
        />
        Photo evidence attached
      </label>
      <p className="field-help">MVP note: this stores a yes/no evidence flag. TODO: add real image upload, metadata checks, and privacy review.</p>
      <button type="submit" className="primary">
        Save Emergency Report
      </button>
    </form>
  );
}
