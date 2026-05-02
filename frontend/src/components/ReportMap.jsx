import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { LocateFixed } from "lucide-react";
import { CATEGORY_MARKERS, URGENCY_CLASS, WORLD_CENTER } from "../utils/constants";
import { calculateConfidence, getFreshness, getVerificationLabel } from "../utils/reportUtils";

export default function ReportMap({ reports, allReports = reports }) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const markerLayerRef = useRef(null);
  const userMarkerRef = useRef(null);
  const [locationMessage, setLocationMessage] = useState("");
  const [locationTone, setLocationTone] = useState("info");

  const center = useMemo(() => {
    if (!reports.length) return WORLD_CENTER;
    return [reports[0].latitude, reports[0].longitude];
  }, [reports]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    mapRef.current = L.map(containerRef.current).setView(center, reports.length ? 14 : 2);
    markerLayerRef.current = L.layerGroup().addTo(mapRef.current);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(mapRef.current);
    // TODO: Replace the URL above with a local tile server or packaged offline tile directory
    // when RescueMesh supports offline map packs for field deployments.
  }, [center]);

  useEffect(() => {
    if (!mapRef.current || !markerLayerRef.current) return;
    markerLayerRef.current.clearLayers();

    reports.forEach((report) => {
      const freshness = getFreshness(report);
      const confidence = calculateConfidence(report, allReports);
      const verificationLabel = getVerificationLabel(report, allReports);
      const marker = L.marker([report.latitude, report.longitude], {
        icon: L.divIcon({
          className: `mesh-marker ${URGENCY_CLASS[report.urgency]} marker-${verificationLabel.toLowerCase().replaceAll(" ", "-")} ${report.status === "Resolved" ? "marker-resolved" : ""} ${freshness.label === "Stale" ? "marker-stale" : ""}`,
          html: `<span>${CATEGORY_MARKERS[report.category] || "INFO"}</span>`,
          iconSize: [46, 30],
          iconAnchor: [23, 30]
        })
      });
      marker.bindPopup(`
        <strong>${report.title}</strong><br />
        ${report.description || ""}<br />
        <b>Urgency:</b> ${report.urgency}<br />
        <b>Status:</b> ${report.status}<br />
        <b>Verification:</b> ${verificationLabel}<br />
        <b>Freshness:</b> ${freshness.label}<br />
        <b>Confidence:</b> ${confidence}%<br />
        <b>Time:</b> ${new Date(report.timestamp).toLocaleString()}
      `);
      marker.addTo(markerLayerRef.current);
    });

    if (reports.length) {
      mapRef.current.fitBounds(reports.map((report) => [report.latitude, report.longitude]), { padding: [30, 30], maxZoom: 15 });
    }
  }, [reports, allReports]);

  function locateDevice() {
    if (!navigator.geolocation) {
      setLocationTone("warning");
      setLocationMessage("This browser does not support device location.");
      return;
    }

    setLocationTone("info");
    setLocationMessage("Requesting your real device location...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latLng = [position.coords.latitude, position.coords.longitude];
        setLocationTone("success");
        setLocationMessage(`Showing real device location: ${latLng[0].toFixed(5)}, ${latLng[1].toFixed(5)}`);

        if (userMarkerRef.current) {
          userMarkerRef.current.remove();
        }

        userMarkerRef.current = L.circleMarker(latLng, {
          radius: 9,
          color: "#155b3d",
          fillColor: "#2fb36d",
          fillOpacity: 0.9,
          weight: 3
        })
          .bindPopup("Your real device location")
          .addTo(mapRef.current);

        mapRef.current.setView(latLng, 15);
      },
      (error) => {
        const permissionDenied = error.code === error.PERMISSION_DENIED;
        setLocationTone("warning");
        setLocationMessage(
          permissionDenied
            ? "Location permission was denied. Allow location access in the browser to show your real position."
            : "The browser could not get a real device location."
        );
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000
      }
    );
  }

  return (
    <div className="map-shell">
      <div className="map-toolbar">
        <button type="button" className="secondary" onClick={locateDevice}>
          <LocateFixed size={18} /> Show My Real Location
        </button>
        {locationMessage && <span className={`location-message ${locationTone}`}>{locationMessage}</span>}
      </div>
      <div className="map-panel" ref={containerRef} />
    </div>
  );
}
