import { useState } from "react";
import { LocateFixed, MapPin, Search } from "lucide-react";
import { geocodeLocation } from "../api/client";
import { CATEGORIES, STATUSES, URGENCY_LEVELS } from "../utils/constants";
import { findPossibleDuplicate, makeReportId } from "../utils/reportUtils";

const initialForm = {
  title: "",
  category: "Need Help",
  description: "",
  urgency: "Medium",
  locationQuery: "",
  locationName: "",
  locationAddress: "",
  latitude: "",
  longitude: "",
  status: "Unverified",
  photoEvidenceAttached: false
};

export default function ReportForm({ deviceId, reports = [], onSubmit }) {
  const [form, setForm] = useState(initialForm);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("info");
  const [locationResults, setLocationResults] = useState([]);
  const [locationLoading, setLocationLoading] = useState(false);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function applyLocationSuggestion(suggestion) {
    setForm((current) => ({
      ...current,
      locationQuery: suggestion.address || suggestion.name,
      locationName: suggestion.name || suggestion.address,
      locationAddress: suggestion.address || "",
      latitude: Number(suggestion.latitude).toFixed(6),
      longitude: Number(suggestion.longitude).toFixed(6)
    }));
    setLocationResults([]);
    setMessageTone("success");
    setMessage(`Location set to ${suggestion.name || "selected place"}. Coordinates are still editable below.`);
  }

  async function searchLocation(event) {
    event?.preventDefault();
    const query = form.locationQuery.trim();
    if (query.length < 2) {
      setMessageTone("warning");
      setMessage("Type a place, address, or campus location before searching.");
      return;
    }

    setLocationLoading(true);
    setMessageTone("info");
    setMessage("Searching for that location...");

    try {
      const results = await geocodeLocation(query);
      setLocationResults(results);
      if (results.length === 1) {
        applyLocationSuggestion(results[0]);
        return;
      }
      setMessageTone(results.length ? "info" : "warning");
      setMessage(results.length ? "Choose the matching location below." : "No matching location found. You can still enter coordinates manually.");
    } catch {
      setLocationResults([]);
      setMessageTone("warning");
      setMessage("Location search is unavailable right now. Enter coordinates manually or use current location.");
    } finally {
      setLocationLoading(false);
    }
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
        setForm((current) => ({
          ...current,
          locationName: "Current device location",
          locationQuery: current.locationQuery || "Current device location",
          locationAddress: "",
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6)
        }));
        setLocationResults([]);
        setMessageTone("success");
        setMessage("Real device location filled from your browser. Coordinates are still editable below.");
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
      location_name: form.locationName.trim() || form.locationQuery.trim(),
      location_address: form.locationAddress.trim(),
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
      <div className="location-search-block">
        <label>
          Incident location
          <div className="location-search-row">
            <input
              value={form.locationQuery}
              onChange={(event) => {
                updateField("locationQuery", event.target.value);
                updateField("locationName", "");
                updateField("locationAddress", "");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") searchLocation(event);
              }}
              placeholder="Search an address, place, or known location"
            />
            <button type="button" className="secondary" onClick={searchLocation} disabled={locationLoading}>
              <Search size={18} /> {locationLoading ? "Searching..." : "Find"}
            </button>
          </div>
        </label>
        {locationResults.length > 0 && (
          <div className="location-results" aria-label="Location search results">
            {locationResults.map((result) => (
              <button
                type="button"
                className="location-result"
                key={`${result.source}-${result.latitude}-${result.longitude}-${result.name}`}
                onClick={() => applyLocationSuggestion(result)}
              >
                <MapPin size={17} />
                <span>
                  <strong>{result.name}</strong>
                  <small>{result.address || `${Number(result.latitude).toFixed(5)}, ${Number(result.longitude).toFixed(5)}`}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
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
