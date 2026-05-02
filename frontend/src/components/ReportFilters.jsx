import { CATEGORIES, STATUSES, URGENCY_LEVELS } from "../utils/constants";

export default function ReportFilters({ filters, onChange }) {
  function updateFilter(key, value) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className="filters">
      <label>
        Category
        <select value={filters.category} onChange={(event) => updateFilter("category", event.target.value)}>
          <option value="All">All categories</option>
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </label>
      <label>
        Urgency
        <select value={filters.urgency} onChange={(event) => updateFilter("urgency", event.target.value)}>
          <option value="All">All urgency levels</option>
          {URGENCY_LEVELS.map((urgency) => (
            <option key={urgency} value={urgency}>
              {urgency}
            </option>
          ))}
        </select>
      </label>
      <label>
        Status
        <select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}>
          <option value="All">All statuses</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <label>
        Verification
        <select value={filters.verification} onChange={(event) => updateFilter("verification", event.target.value)}>
          <option value="All">All verification</option>
          {["Low Trust", "Unverified", "Likely Verified", "Verified"].map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Confidence
        <select value={filters.confidence} onChange={(event) => updateFilter("confidence", event.target.value)}>
          <option value="All">Any confidence</option>
          <option value="0-29">0-29%</option>
          <option value="30-59">30-59%</option>
          <option value="60-79">60-79%</option>
          <option value="80-100">80-100%</option>
        </select>
      </label>
      <label>
        Age
        <select value={filters.aging} onChange={(event) => updateFilter("aging", event.target.value)}>
          <option value="All">Any age</option>
          {["Fresh", "Recent", "Aging", "Stale"].map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={filters.needsReview} onChange={(event) => updateFilter("needsReview", event.target.checked)} />
        Needs Review
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={filters.suspicious} onChange={(event) => updateFilter("suspicious", event.target.checked)} />
        Suspicious
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={filters.responderVerified} onChange={(event) => updateFilter("responderVerified", event.target.checked)} />
        Responder Verified
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={filters.stale} onChange={(event) => updateFilter("stale", event.target.checked)} />
        Stale
      </label>
    </div>
  );
}
