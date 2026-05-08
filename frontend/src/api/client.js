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
    const error = new Error(message || `Request failed: ${response.status}`);
    error.status = response.status;
    throw error;
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

export function getReportComments(reportId) {
  return request(`/reports/${encodeURIComponent(reportId)}/comments`);
}

export function postReportComment(reportId, comment) {
  return request(`/reports/${encodeURIComponent(reportId)}/comments`, {
    method: "POST",
    body: JSON.stringify(comment)
  });
}

export function resolveReport(reportId) {
  return request(`/reports/${encodeURIComponent(reportId)}/resolve`, {
    method: "POST"
  });
}

export function responderVerifyReport(reportId) {
  return request(`/reports/${encodeURIComponent(reportId)}/responder-verify`, {
    method: "POST"
  });
}

export function responderRejectReport(reportId) {
  return request(`/reports/${encodeURIComponent(reportId)}/responder-reject`, {
    method: "POST"
  });
}

export function addResponderNote(reportId, note) {
  return request(`/reports/${encodeURIComponent(reportId)}/responder-note`, {
    method: "POST",
    body: JSON.stringify({ note })
  });
}

export function getNeedsReviewReports() {
  return request("/reports/needs-review");
}

export function getVerificationConfig() {
  return request("/verification/config");
}

export function geocodeLocation(query, options = {}) {
  return request(`/geocode?query=${encodeURIComponent(query)}&limit=${options.limit || 5}`, {
    signal: options.signal
  });
}

export function getLiveIncidents(options = {}) {
  const days = options.days || 7;
  const limit = options.limit || 200;
  return request(`/live-incidents?days=${encodeURIComponent(days)}&limit=${encodeURIComponent(limit)}`, {
    signal: options.signal
  });
}

export function getLiveIncidentStatus(options = {}) {
  return request("/live-incidents/status", { signal: options.signal });
}

export function refreshLiveIncidents(options = {}) {
  const days = options.days || 7;
  const limit = options.limit || 200;
  return request(`/live-incidents/refresh?days=${encodeURIComponent(days)}&limit=${encodeURIComponent(limit)}`, {
    method: "POST",
    signal: options.signal
  });
}

export function getIncidentGuidance(report, options = {}) {
  const confidenceScore = report.confidence_score ?? report.confidenceScore;
  const verificationLabel = report.verification_label ?? report.verificationLabel;
  const agingLabel = report.aging_label ?? report.agingLabel;

  return request("/ai/incident-guidance", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify({
      title: report.title,
      category: report.category,
      description: report.description || "",
      urgency: report.urgency,
      status: report.status,
      timestamp: report.timestamp,
      latitude: report.latitude,
      longitude: report.longitude,
      confidence_score: confidenceScore,
      verification_label: verificationLabel,
      aging_label: agingLabel
    })
  });
}

export function deleteDemoReports(reportIds = []) {
  return request("/demo/reports", {
    method: "DELETE",
    body: JSON.stringify({ report_ids: reportIds })
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
