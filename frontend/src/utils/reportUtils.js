const DUPLICATE_WINDOW_MS = 6 * 60 * 60 * 1000;
const DUPLICATE_DISTANCE_METERS = 250;

export function makeReportId(deviceId) {
  return `rm-${deviceId}-${Date.now()}-${crypto.randomUUID()}`;
}

export function keywordSet(title) {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((word) => word.length > 2)
  );
}

export function haversineMeters(a, b) {
  const radius = 6371000;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function findPossibleDuplicate(candidate, reports) {
  const candidateWords = keywordSet(candidate.title);
  const candidateTime = new Date(candidate.timestamp).getTime();

  return reports.find((report) => {
    if (report.category !== candidate.category) return false;

    const reportWords = keywordSet(report.title);
    const sharedWords = [...candidateWords].filter((word) => reportWords.has(word));
    if (sharedWords.length === 0) return false;

    const distance = haversineMeters(candidate, report);
    if (distance > DUPLICATE_DISTANCE_METERS) return false;

    const reportTime = new Date(report.timestamp).getTime();
    return Math.abs(candidateTime - reportTime) <= DUPLICATE_WINDOW_MS;
  });
}

export function mergeReport(existing, incoming) {
  if (!existing) return normalizeReport(incoming);
  const incomingCount = incoming.confirmation_count ?? 0;
  const existingCount = existing.confirmation_count ?? 0;
  return normalizeReport({
    ...existing,
    ...incoming,
    confirmation_count: Math.max(existingCount, incomingCount),
    confirmed_by_device_ids: existing.confirmed_by_device_ids || []
  });
}

export function normalizeReport(report) {
  return {
    ...report,
    latitude: Number(report.latitude),
    longitude: Number(report.longitude),
    confirmation_count: report.confirmation_count ?? 0,
    confirmed_by_device_ids: report.confirmed_by_device_ids || [],
    sync_state: report.sync_state || "synced"
  };
}

export function sortByNewest(reports) {
  return [...reports].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

export function sortByOldest(reports) {
  return [...reports].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

export function toCsv(reports) {
  const columns = [
    "report_id",
    "title",
    "category",
    "description",
    "urgency",
    "latitude",
    "longitude",
    "status",
    "timestamp",
    "device_id",
    "confirmation_count"
  ];
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [columns.join(","), ...reports.map((report) => columns.map((column) => escape(report[column])).join(","))].join("\n");
}

export function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
