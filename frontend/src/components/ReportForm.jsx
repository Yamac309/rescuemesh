import { useEffect, useState } from "react";
import { LocateFixed, MapPin, Search } from "lucide-react";
import { geocodeLocation } from "../api/client";
import { CATEGORIES, STATUSES, URGENCY_LEVELS, isInsideUsaBounds } from "../utils/constants";
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
  photoEvidenceAttached: false,
};

export default function ReportForm({ deviceId, reports = [], onSubmit }) {
  const [form, setForm] = useState(initialForm);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("info");
  const [locationResults, setLocationResults] = useState([]);
  const [locationLoading, setLocationLoading] = useState(false);

  function updateField(field, value) {
    setForm((cur) => ({ ...cur, [field]: value }));
  }

  function applyLocationSuggestion(suggestion) {
    if (!isInsideUsaBounds(suggestion)) {
      setMessageTone("warning");
      setMessage("RescueMesh is currently limited to U.S. incident locations.");
      return;
    }
    setForm((cur) => ({
      ...cur,
      locationQuery: suggestion.address || suggestion.name,
      locationName: suggestion.name || suggestion.address,
      locationAddress: suggestion.address || "",
      latitude: Number(suggestion.latitude).toFixed(6),
      longitude: Number(suggestion.longitude).toFixed(6),
    }));
    setLocationResults([]);
    setMessageTone("success");
    setMessage(`Location set to ${suggestion.name || "selected place"}.`);
  }

  async function runLocationSearch(query, options = {}) {
    const { signal, showMessages = false } = options;
    if (query.length < 2) {
      setLocationResults([]);
      if (showMessages) {
        setMessageTone("warning");
        setMessage("Type a place, address, or location before searching.");
      }
      return;
    }
    setLocationLoading(true);
    if (showMessages) {
      setMessageTone("info");
      setMessage("Searching...");
    }
    try {
      const results = await geocodeLocation(query, { signal });
      setLocationResults(results);
      if (showMessages) {
        setMessageTone(results.length ? "info" : "warning");
        setMessage(
          results.length
            ? "Choose the matching location below."
            : "No matching location found. You can enter coordinates manually."
        );
      }
    } catch (error) {
      if (error.name === "AbortError") return;
      setLocationResults([]);
      if (showMessages) {
        setMessageTone("warning");
        setMessage("Location search unavailable. Enter coordinates manually or use current location.");
      }
    } finally {
      setLocationLoading(false);
    }
  }

  async function searchLocation(event) {
    event?.preventDefault();
    await runLocationSearch(form.locationQuery.trim(), { showMessages: true });
  }

  useEffect(() => {
    const query = form.locationQuery.trim();
    const selectedQuery = form.locationAddress || form.locationName;
    if (query.length < 2 || (selectedQuery && query === selectedQuery)) {
      setLocationResults([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      runLocationSearch(query, { signal: controller.signal });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [form.locationAddress, form.locationName, form.locationQuery]);

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setMessageTone("warning");
      setMessage("This browser does not support device location. Enter coordinates manually.");
      return;
    }
    setMessageTone("info");
    setMessage("Requesting device location...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        if (!isInsideUsaBounds(location)) {
          setMessageTone("warning");
          setMessage("Your device location is outside the U.S. operating area. Enter a U.S. incident location manually.");
          return;
        }
        setForm((cur) => ({
          ...cur,
          locationName: "Current device location",
          locationQuery: cur.locationQuery || "Current device location",
          locationAddress: "",
          latitude: location.latitude.toFixed(6),
          longitude: location.longitude.toFixed(6),
        }));
        setLocationResults([]);
        setMessageTone("success");
        setMessage("Location filled from device. Coordinates are still editable.");
      },
      (error) => {
        setMessageTone("warning");
        setMessage(
          error.code === error.PERMISSION_DENIED
            ? "Location permission denied. Allow access or enter coordinates manually."
            : "Could not get device location. Enter coordinates manually."
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
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
      sync_state: "pending",
    };

    if (!isInsideUsaBounds(report)) {
      setMessageTone("warning");
      setMessage("RescueMesh is currently limited to U.S. incident locations. Choose coordinates inside the U.S. operating area.");
      return;
    }

    const possibleDuplicate = findPossibleDuplicate(report, reports);
    if (possibleDuplicate) {
      const shouldContinue = window.confirm(
        `This looks similar to: "${possibleDuplicate.title}". Create a new report anyway?`
      );
      if (!shouldContinue) {
        setMessageTone("info");
        setMessage("Report not saved. You can update details or confirm the existing report.");
        return;
      }
    }

    try {
      const duplicate = await onSubmit(report);
      setForm(initialForm);
      setMessageTone(duplicate ? "warning" : "success");
      setMessage(
        duplicate
          ? `Possible duplicate of "${duplicate.title}". Report was still saved.`
          : "Report saved and added to the dashboard."
      );
    } catch (error) {
      console.error("Unable to create report", error);
      setMessageTone("warning");
      setMessage("Could not save report. Check required fields and try again.");
    }
  }

  return (
    <form className="report-form" onSubmit={handleSubmit}>
      {message && <div className={`notice ${messageTone}`}>{message}</div>}

      {/* -- Core fields -- */}
      <label>
        Title
        <input
          value={form.title}
          onChange={(e) => updateField("title", e.target.value)}
          placeholder="Brief, descriptive incident title"
          required
          maxLength={120}
        />
      </label>

      <div className="form-grid">
        <label>
          Category
          <select value={form.category} onChange={(e) => updateField("category", e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>
          Urgency
          <select value={form.urgency} onChange={(e) => updateField("urgency", e.target.value)}>
            {URGENCY_LEVELS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
        <label>
          Status
          <select value={form.status} onChange={(e) => updateField("status", e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      <label>
        Description
        <textarea
          value={form.description}
          onChange={(e) => updateField("description", e.target.value)}
          placeholder="What is happening? Include any relevant details."
          rows={4}
        />
      </label>

      {/* -- Location -- */}
      <div className="form-section-divider">Location</div>

      <div className="location-search-block">
        <label>
          Incident location
          <div className="location-search-row">
            <input
              value={form.locationQuery}
              onChange={(e) => {
                updateField("locationQuery", e.target.value);
                updateField("locationName", "");
                updateField("locationAddress", "");
              }}
              onKeyDown={(e) => { if (e.key === "Enter") searchLocation(e); }}
              placeholder="Search address, place, or landmark"
            />
            <button
              type="button"
              className="secondary"
              onClick={searchLocation}
              disabled={locationLoading}
            >
              <Search size={16} /> {locationLoading ? "Searching..." : "Search"}
            </button>
          </div>
        </label>

        {locationResults.length > 0 && (
          <div className="location-results" aria-label="Location results">
            {locationResults.map((result) => (
              <button
                type="button"
                className="location-result"
                key={`${result.source}-${result.latitude}-${result.longitude}-${result.name}`}
                onClick={() => applyLocationSuggestion(result)}
              >
                <MapPin size={15} />
                <span>
                  <strong>{result.name}</strong>
                  <small>
                    {result.address ||
                      `${Number(result.latitude).toFixed(5)}, ${Number(result.longitude).toFixed(5)}`}
                  </small>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="coordinate-row">
        <label>
          Latitude
          <input
            type="number"
            step="any"
            min="-90"
            max="90"
            value={form.latitude}
            onChange={(e) => updateField("latitude", e.target.value)}
            placeholder="e.g. 37.7749"
            required
          />
        </label>
        <label>
          Longitude
          <input
            type="number"
            step="any"
            min="-180"
            max="180"
            value={form.longitude}
            onChange={(e) => updateField("longitude", e.target.value)}
            placeholder="e.g. -122.4194"
            required
          />
        </label>
        <button
          type="button"
          className="icon-button"
          onClick={useCurrentLocation}
          title="Use current device location"
        >
          <LocateFixed size={18} />
        </button>
      </div>
      <p className="field-help">
        Coordinates mark the incident location, not necessarily your current position.
      </p>

      {/* -- Evidence -- */}
      <div className="form-section-divider">Evidence</div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={form.photoEvidenceAttached}
          onChange={(e) => updateField("photoEvidenceAttached", e.target.checked)}
        />
        Photo evidence attached
      </label>
      <p className="field-help">
        MVP: stores a yes/no flag. Image upload with metadata and privacy review coming later.
      </p>

      <button type="submit" className="primary">
        Save Report
      </button>
    </form>
  );
}
