import { useCallback, useEffect, useRef, useState } from "react";
import { getLiveIncidentStatus, getLiveIncidents, refreshLiveIncidents } from "../api/client";

function normalizeLiveIncident(incident) {
  return {
    ...incident,
    report_id: incident.incident_id,
    incidentId: incident.incident_id,
    locationName: incident.location_name || "",
    locationAddress: incident.location_address || "",
    latitude: Number(incident.latitude),
    longitude: Number(incident.longitude),
    confidenceScore: 90,
    confidence_score: 90,
    verificationLabel: "Verified",
    verification_label: "Verified",
    source: incident.source || "Live source",
    sourceUrl: incident.source_url || "",
    eventType: incident.event_type || "",
    expiresAt: incident.expires_at || "",
    isLiveIncident: true
  };
}

export function useLiveIncidents({ enabled = true, days = 7, limit = 200 } = {}) {
  const [incidents, setIncidents] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const mountedRef = useRef(false);

  const load = useCallback(
    async ({ refresh = false } = {}) => {
      if (!enabled) return [];

      const controller = new AbortController();
      const setter = refresh ? setRefreshing : setLoading;
      setter(true);
      setError("");

      try {
        const [nextStatus, nextIncidents] = await Promise.all([
          getLiveIncidentStatus({ signal: controller.signal }),
          getLiveIncidents({ days, limit, signal: controller.signal })
        ]);
        if (!mountedRef.current) return [];
        setStatus(nextStatus);
        setIncidents(nextIncidents.map(normalizeLiveIncident));
        return nextIncidents;
      } catch (requestError) {
        if (!mountedRef.current) return [];
        setError("Live incidents are unavailable right now.");
        return [];
      } finally {
        if (mountedRef.current) setter(false);
      }
    },
    [days, enabled, limit]
  );

  const refresh = useCallback(async () => {
    if (!enabled) return;

    setRefreshing(true);
    setError("");
    try {
      const response = await refreshLiveIncidents({ days, limit });
      setStatus(response.status);
      setIncidents((response.incidents || []).map(normalizeLiveIncident));
    } catch {
      setError("Connect MongoDB Atlas to refresh the live incident feed.");
    } finally {
      setRefreshing(false);
    }
  }, [days, enabled, limit]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    const interval = window.setInterval(() => load(), 5 * 60 * 1000);
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
    };
  }, [load]);

  return {
    incidents,
    status,
    loading,
    refreshing,
    error,
    refresh,
    reload: load
  };
}
