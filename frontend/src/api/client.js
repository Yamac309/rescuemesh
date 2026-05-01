function getApiBaseUrl() {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, "");
  }

  if (typeof window === "undefined") {
    return "http://localhost:8000";
  }

  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  const { hostname, port, origin } = window.location;

  if (port && port !== "8000") {
    return `${protocol}//${hostname}:8000`;
  }

  return origin;
}

async function request(path, options = {}) {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }

  return response.json();
}

export function getReports() {
  return request("/reports");
}

export function postReport(report) {
  return request("/reports", {
    method: "POST",
    body: JSON.stringify(report)
  });
}

export function syncReports(knownReportIds, reports) {
  return request("/sync", {
    method: "POST",
    body: JSON.stringify({ known_report_ids: knownReportIds, reports })
  });
}

export function confirmReport(reportId, deviceId) {
  return request(`/reports/${encodeURIComponent(reportId)}/confirm`, {
    method: "POST",
    body: JSON.stringify({ device_id: deviceId })
  });
}

export function resolveReport(reportId) {
  return request(`/reports/${encodeURIComponent(reportId)}/resolve`, {
    method: "POST"
  });
}

export function deleteDemoReports() {
  return request("/demo/reports", {
    method: "DELETE"
  });
}

export function deleteAllReports() {
  return request("/reports", {
    method: "DELETE"
  });
}

export function getNodeStatus() {
  return request("/node/status");
}

export function getHealth() {
  return request("/health");
}

export function createSocket() {
  return new WebSocket(`${getApiBaseUrl().replace(/^http/, "ws")}/ws`);
}
