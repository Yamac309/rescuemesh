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
    </div>
  );
}
