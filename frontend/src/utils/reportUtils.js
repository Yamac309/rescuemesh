const DUPLICATE_WINDOW_MS = 6 * 60 * 60 * 1000;
const DUPLICATE_DISTANCE_METERS = 250;
const NEARBY_MATCH_DISTANCE_METERS = 300;
const NEARBY_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DEMO_TIME_OFFSET_KEY = "rescuemesh-demo-time-offset-hours";

const DEFAULT_EMERGENCY_ZONE = {
  minLatitude: 40.7,
  maxLatitude: 40.725,
  minLongitude: -74.02,
  maxLongitude: -73.99
};

export function getDemoTimeOffsetHours() {
  if (typeof localStorage === "undefined") return 0;
  return Number(localStorage.getItem(DEMO_TIME_OFFSET_KEY) || 0);
}

export function getDemoNowMs() {
  return Date.now() + getDemoTimeOffsetHours() * 60 * 60 * 1000;
}

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
  return findSimilarNearbyReports(candidate, reports, {
    distanceMeters: DUPLICATE_DISTANCE_METERS,
    timeWindowMs: DUPLICATE_WINDOW_MS
  })[0];
}

export function findSimilarNearbyReports(candidate, reports, options = {}) {
  const distanceMeters = options.distanceMeters ?? NEARBY_MATCH_DISTANCE_METERS;
  const timeWindowMs = options.timeWindowMs ?? NEARBY_MATCH_WINDOW_MS;
  const candidateWords = keywordSet(candidate.title);
  const candidateTime = new Date(candidate.timestamp).getTime();

  return reports.filter((report) => {
    if (report.report_id === candidate.report_id) return false;
    if (report.category !== candidate.category) return false;

    const reportWords = keywordSet(report.title);
    const sharedWords = [...candidateWords].filter((word) => reportWords.has(word));
    if (sharedWords.length === 0) return false;

    const distance = haversineMeters(candidate, report);
    if (distance > distanceMeters) return false;

    const reportTime = new Date(report.timestamp).getTime();
    return Math.abs(candidateTime - reportTime) <= timeWindowMs;
  });
}

export function getFreshness(report) {
  if (report.agingLabel) {
    return { label: report.agingLabel, className: `freshness-${report.agingLabel.toLowerCase().replace(" ", "-")}`, ageHours: 0 };
  }
  const ageMs = Math.max(0, getDemoNowMs() - new Date(report.timestamp).getTime());
  const ageHours = ageMs / (60 * 60 * 1000);

  if (ageHours < 1) {
    return { label: "Fresh", className: "freshness-fresh", ageHours };
  }
  if (ageHours < 6) {
    return { label: "Recent", className: "freshness-recent", ageHours };
  }
  if (ageHours < 24) {
    return { label: "Aging", className: "freshness-aging", ageHours };
  }
  return { label: "Stale", className: "freshness-stale", ageHours };
}

export function calculateConfidence(report, reports = []) {
  if (typeof report.confidenceScore === "number") return report.confidenceScore;
  if (report.status === "Resolved") return 0;

  const freshness = getFreshness(report);
  const nearbyMatches = findSimilarNearbyReports(report, reports);
  const uniqueNearbyDevices = new Set(nearbyMatches.map((match) => match.device_id)).size;
  let score = 30;

  score += Math.min(report.confirmation_count || 0, 3) * 20;
  if (freshness.label === "Aging") score -= 10;
  if (freshness.label === "Stale") score -= 20;
  if (nearbyMatches.length > 0) score += 15;
  if (uniqueNearbyDevices >= 2) score += 10;

  return Math.max(0, Math.min(100, score));
}

export function getVerificationLabel(report, reports = []) {
  if (report.status === "Resolved") return "Resolved";
  if (report.verificationLabel) return report.verificationLabel;
  const score = calculateConfidence(report, reports);
  if (score < 30) return "Low Trust";
  if (score < 60) return "Unverified";
  if (score < 80) return "Likely Verified";
  return "Verified";
}

export function estimateLocalVerification(report, reports = [], config = {}) {
  const zone = config.emergencyZone || DEFAULT_EMERGENCY_ZONE;
  const knownLocations = config.knownLocations || [];
  const freshness = getFreshness(report);
  const similarReports = findSimilarNearbyReports(report, reports, {
    distanceMeters: DUPLICATE_DISTANCE_METERS,
    timeWindowMs: DUPLICATE_WINDOW_MS
  });
  const confirmationCount = report.uniqueConfirmationCount ?? report.unique_confirmation_count ?? report.confirmation_count ?? 0;
  const seenByNodes = report.seenByNodes || report.seen_by_nodes || ["local-node"];
  const knownLocation = nearestKnownLocation(report, knownLocations);
  const insideEmergencyZone = isInsideEmergencyZone(report, zone);
  const evidenceReasons = [];
  const warningReasons = [];
  let score = 30;

  if (insideEmergencyZone) {
    score += 10;
    evidenceReasons.push("Report is inside the configured emergency area.");
  } else {
    score -= 30;
    warningReasons.push("Report is outside the configured emergency area.");
  }

  if (freshness.label === "Fresh") {
    score += 10;
    evidenceReasons.push("Report is less than 1 hour old.");
  } else if (freshness.label === "Aging") {
    score -= 20;
    warningReasons.push("This report is aging. Verify before relying on it.");
  } else if (freshness.label === "Stale") {
    score -= 35;
    warningReasons.push("This report is old. Verify before relying on it.");
  }

  if (knownLocation) {
    score += 10;
    evidenceReasons.push(`Report is near known location: ${knownLocation.name}.`);
  }

  if (similarReports.length) {
    score += 15;
    evidenceReasons.push("Similar nearby reports were found.");
  }

  if (confirmationCount) {
    score += Math.min(confirmationCount, 3) * 10;
    evidenceReasons.push(`${confirmationCount} unique confirmations.`);
  }

  if (report.responderVerified || report.responder_verified) {
    score += 30;
    evidenceReasons.push("Responder verified this report.");
  } else {
    warningReasons.push("No responder verification yet.");
  }

  if (report.responderRejected || report.responder_rejected) {
    score -= 40;
    warningReasons.push("Responder rejected this report.");
  }

  if (report.photoEvidenceAttached || report.photo_evidence_attached) {
    score += 10;
    evidenceReasons.push("Photo evidence attached.");
  }

  if (seenByNodes.length >= 2) {
    score += 10;
    evidenceReasons.push("Report has been seen by multiple nodes.");
  }

  score = Math.max(0, Math.min(100, score));
  const verificationLabel = labelForScore(score, Boolean(report.responderRejected || report.responder_rejected));
  const status = report.status !== "Resolved" && score < 30 ? "Needs Review" : report.status;

  return {
    ...report,
    confidenceScore: score,
    confidence_score: score,
    verificationLabel,
    verification_label: verificationLabel,
    evidenceReasons,
    evidence_reasons: evidenceReasons,
    warningReasons,
    warning_reasons: warningReasons,
    agingLabel: freshness.label,
    aging_label: freshness.label,
    status,
    verificationSignals: {
      insideEmergencyZone,
      nearKnownLocation: Boolean(knownLocation),
      knownLocationName: knownLocation?.name || null,
      isFresh: freshness.label === "Fresh",
      isStale: freshness.label === "Stale",
      hasSimilarNearbyReports: Boolean(similarReports.length),
      similarReportCount: similarReports.length,
      uniqueConfirmationCount: confirmationCount,
      responderVerified: Boolean(report.responderVerified || report.responder_verified),
      responderRejected: Boolean(report.responderRejected || report.responder_rejected),
      deviceTrustScore: report.verificationSignals?.deviceTrustScore ?? 70,
      suspiciousDeviceActivity: false,
      photoEvidenceAttached: Boolean(report.photoEvidenceAttached || report.photo_evidence_attached),
      seenByNodeCount: seenByNodes.length
    },
    verification_signals: {
      insideEmergencyZone,
      nearKnownLocation: Boolean(knownLocation),
      knownLocationName: knownLocation?.name || null,
      isFresh: freshness.label === "Fresh",
      isStale: freshness.label === "Stale",
      hasSimilarNearbyReports: Boolean(similarReports.length),
      similarReportCount: similarReports.length,
      uniqueConfirmationCount: confirmationCount,
      responderVerified: Boolean(report.responderVerified || report.responder_verified),
      responderRejected: Boolean(report.responderRejected || report.responder_rejected),
      deviceTrustScore: report.verificationSignals?.deviceTrustScore ?? 70,
      suspiciousDeviceActivity: false,
      photoEvidenceAttached: Boolean(report.photoEvidenceAttached || report.photo_evidence_attached),
      seenByNodeCount: seenByNodes.length
    }
  };
}

function labelForScore(score, responderRejected = false) {
  if (responderRejected) return "Low Trust";
  if (score < 30) return "Low Trust";
  if (score < 60) return "Unverified";
  if (score < 80) return "Likely Verified";
  return "Verified";
}

function isInsideEmergencyZone(report, zone) {
  return (
    zone.minLatitude <= report.latitude &&
    report.latitude <= zone.maxLatitude &&
    zone.minLongitude <= report.longitude &&
    report.longitude <= zone.maxLongitude
  );
}

function nearestKnownLocation(report, knownLocations) {
  let nearest = null;
  let nearestDistance = Infinity;
  knownLocations.forEach((location) => {
    const distance = haversineMeters(report, location);
    if (distance < nearestDistance) {
      nearest = location;
      nearestDistance = distance;
    }
  });
  return nearest && nearestDistance <= 180 ? nearest : null;
}

export function sourceTrustLabel(report) {
  const trustScore = report.verificationSignals?.deviceTrustScore ?? 70;
  if (trustScore >= 75) return "Trusted Source";
  if (trustScore < 40) return "Low Trust Source";
  return "Normal Source";
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
  const verificationSignals = report.verificationSignals || report.verification_signals || {};
  return {
    ...report,
    location_name: report.location_name ?? report.locationName ?? "",
    locationName: report.location_name ?? report.locationName ?? "",
    location_address: report.location_address ?? report.locationAddress ?? "",
    locationAddress: report.location_address ?? report.locationAddress ?? "",
    latitude: Number(report.latitude),
    longitude: Number(report.longitude),
    confirmation_count: report.confirmation_count ?? 0,
    confirmationCount: report.confirmation_count ?? report.confirmationCount ?? 0,
    uniqueConfirmationCount: report.unique_confirmation_count ?? report.uniqueConfirmationCount ?? report.confirmation_count ?? 0,
    confidenceScore: report.confidence_score ?? report.confidenceScore ?? 30,
    verificationLabel: report.verification_label ?? report.verificationLabel ?? "Unverified",
    evidenceReasons: report.evidence_reasons ?? report.evidenceReasons ?? [],
    warningReasons: report.warning_reasons ?? report.warningReasons ?? [],
    agingLabel: report.aging_label ?? report.agingLabel,
    verificationSignals,
    responderVerified: report.responder_verified ?? report.responderVerified ?? false,
    responderRejected: report.responder_rejected ?? report.responderRejected ?? false,
    responderNote: report.responder_note ?? report.responderNote ?? "",
    photoEvidenceAttached: report.photo_evidence_attached ?? report.photoEvidenceAttached ?? false,
    is_demo: report.is_demo ?? report.isDemo ?? false,
    isDemo: report.is_demo ?? report.isDemo ?? false,
    seenByNodes: report.seen_by_nodes ?? report.seenByNodes ?? [],
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
    "locationName",
    "locationAddress",
    "latitude",
    "longitude",
    "status",
    "timestamp",
    "confirmation_count",
    "confidenceScore",
    "verificationLabel",
    "evidenceReasons",
    "warningReasons",
    "agingLabel",
    "uniqueConfirmationCount",
    "responderVerified",
    "responderRejected",
    "responderNote",
    "seenByNodes",
    "sourceTrustLabel"
  ];
  const escape = (value) => `"${String(Array.isArray(value) ? value.join("; ") : value ?? "").replaceAll('"', '""')}"`;
  return [
    columns.join(","),
    ...reports.map((report) => columns.map((column) => escape(column === "sourceTrustLabel" ? sourceTrustLabel(report) : report[column])).join(","))
  ].join("\n");
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
