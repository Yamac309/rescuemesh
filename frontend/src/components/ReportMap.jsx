import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import { CATEGORY_MARKERS, DEFAULT_CENTER, URGENCY_CLASS } from "../utils/constants";

export default function ReportMap({ reports }) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const markerLayerRef = useRef(null);

  const center = useMemo(() => {
    if (!reports.length) return DEFAULT_CENTER;
    return [reports[0].latitude, reports[0].longitude];
  }, [reports]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    mapRef.current = L.map(containerRef.current).setView(center, 14);
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
      const marker = L.marker([report.latitude, report.longitude], {
        icon: L.divIcon({
          className: `mesh-marker ${URGENCY_CLASS[report.urgency]}`,
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
        <b>Time:</b> ${new Date(report.timestamp).toLocaleString()}
      `);
      marker.addTo(markerLayerRef.current);
    });

    if (reports.length) {
      mapRef.current.fitBounds(reports.map((report) => [report.latitude, report.longitude]), { padding: [30, 30], maxZoom: 15 });
    }
  }, [reports]);

  return <div className="map-panel" ref={containerRef} />;
}
