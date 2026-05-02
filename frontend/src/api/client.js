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

export function getIncidentGuidance(report) {
  return request("/ai/incident-guidance", {
    method: "POST",
    body: JSON.stringify({
      title: report.title,
      category: report.category,
      description: report.description || "",
      urgency: report.urgency,
      status: report.status,
      timestamp: report.timestamp,
      latitude: report.latitude,
      longitude: report.longitude,
      confidence_score: report.confidenceScore,
      verification_label: report.verificationLabel,
      aging_label: report.agingLabel
    })
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
