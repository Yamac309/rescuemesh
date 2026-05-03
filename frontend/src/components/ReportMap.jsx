import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { Crosshair, Layers, LocateFixed, MapPinned, Satellite } from "lucide-react";
import { CATEGORY_MARKERS, URGENCY_CLASS, WORLD_CENTER } from "../utils/constants";
import { calculateConfidence, getFreshness, getVerificationLabel } from "../utils/reportUtils";

const MAPKIT_TOKEN = import.meta.env.VITE_MAPKIT_JS_TOKEN;
const APPLE_MAPS_ENABLED = Boolean(MAPKIT_TOKEN?.trim());

const LEAFLET_TILES = {
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri"
  },
  street: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors"
  }
};

const URGENCY_COLORS = {
  Low: "#2463a7",
  Medium: "#bd6b00",
  High: "#cc4b24",
  Critical: "#b42318"
};

let mapKitLoadPromise;

function loadMapKit() {
  if (!APPLE_MAPS_ENABLED) return Promise.reject(new Error("MapKit token is not configured."));
  if (window.mapkit && window.__rescueMeshMapKitReady) return Promise.resolve(window.mapkit);
  if (mapKitLoadPromise) return mapKitLoadPromise;

  mapKitLoadPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector("script[data-rescuemesh-mapkit]");
    const script = existingScript || document.createElement("script");

    script.addEventListener(
      "load",
      () => {
        if (!window.mapkit) {
          reject(new Error("MapKit JS did not load."));
          return;
        }
        if (!window.__rescueMeshMapKitReady) {
          window.mapkit.init({
            authorizationCallback(done) {
              done(MAPKIT_TOKEN);
            }
          });
          window.__rescueMeshMapKitReady = true;
        }
        resolve(window.mapkit);
      },
      { once: true }
    );
    script.addEventListener("error", () => reject(new Error("MapKit JS failed to load.")), { once: true });

    if (!existingScript) {
      script.src = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";
      script.crossOrigin = "anonymous";
      script.dataset.rescuemeshMapkit = "true";
      document.head.appendChild(script);
    }
  });

  return mapKitLoadPromise;
}

function mapKitType(mapkit, mode) {
  const types = mapkit.Map?.MapTypes || {};
  if (mode === "street") return types.Standard || types.MutedStandard;
  return types.Hybrid || types.Satellite || types.Standard;
}

function popupHtml(report, verificationLabel, freshness, confidence) {
  return `
    <div class="map-popup">
      <strong>${report.title}</strong>
      ${report.locationName ? `<span>${report.locationName}</span>` : ""}
      ${report.locationAddress ? `<small>${report.locationAddress}</small>` : ""}
      ${report.description ? `<p>${report.description}</p>` : ""}
      <dl>
        <dt>Urgency</dt><dd>${report.urgency}</dd>
        <dt>Status</dt><dd>${report.status}</dd>
        <dt>Verification</dt><dd>${verificationLabel}</dd>
        <dt>Freshness</dt><dd>${freshness.label}</dd>
        <dt>Confidence</dt><dd>${confidence}%</dd>
      </dl>
    </div>
  `;
}

export default function ReportMap({ reports, allReports = reports }) {
  const mapRef = useRef(null);
  const engineRef = useRef(null);
  const containerRef = useRef(null);
  const markerLayerRef = useRef(null);
  const tileLayerRef = useRef(null);
  const mapKitAnnotationsRef = useRef([]);
  const userMarkerRef = useRef(null);
  const fitTimersRef = useRef([]);
  const resizeObserverRef = useRef(null);
  const [locationMessage, setLocationMessage] = useState("");
  const [locationTone, setLocationTone] = useState("info");
  const [mapMode, setMapMode] = useState("satellite");
  const [mapProvider, setMapProvider] = useState(APPLE_MAPS_ENABLED ? "Loading Apple Maps" : "Satellite");

  const center = useMemo(() => {
    if (!reports.length) return WORLD_CENTER;
    return [reports[0].latitude, reports[0].longitude];
  }, [reports]);

  const openReportCount = reports.filter((report) => report.status !== "Resolved").length;
  const criticalCount = reports.filter((report) => report.urgency === "Critical" && report.status !== "Resolved").length;
  const reportsKey = useMemo(
    () => reports.map((report) => `${report.report_id}:${report.latitude}:${report.longitude}`).join("|"),
    [reports]
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    let canceled = false;

    function createLeafletMap(providerLabel = "Satellite") {
      if (canceled || !containerRef.current || mapRef.current) return;
      engineRef.current = "leaflet";
      setMapProvider(providerLabel);

      const map = L.map(containerRef.current, {
        zoomControl: false,
        preferCanvas: true
      }).setView(center, reports.length ? 15 : 2);
      mapRef.current = map;
      L.control.zoom({ position: "bottomright" }).addTo(map);
      markerLayerRef.current = L.layerGroup().addTo(map);
      tileLayerRef.current = L.tileLayer(LEAFLET_TILES[mapMode].url, {
        maxZoom: 19,
        attribution: LEAFLET_TILES[mapMode].attribution
      }).addTo(map);
      if (window.ResizeObserver) {
        resizeObserverRef.current = new ResizeObserver(() => {
          map.invalidateSize();
        });
        resizeObserverRef.current.observe(containerRef.current);
      }
      window.requestAnimationFrame(() => map.invalidateSize());
      window.setTimeout(() => fitReports(), 0);
    }

    if (APPLE_MAPS_ENABLED) {
      loadMapKit()
        .then((mapkit) => {
          if (canceled || !containerRef.current || mapRef.current) return;
          engineRef.current = "mapkit";
          setMapProvider("Apple Maps");
          const map = new mapkit.Map(containerRef.current, {
            showsCompass: mapkit.FeatureVisibility?.Adaptive,
            showsMapTypeControl: true,
            showsScale: mapkit.FeatureVisibility?.Adaptive,
            showsZoomControl: true,
            tintColor: "#1f7a53"
          });
          map.mapType = mapKitType(mapkit, mapMode);
          mapRef.current = map;
          if (reports.length) {
            map.center = new mapkit.Coordinate(center[0], center[1]);
          }
          window.setTimeout(() => fitReports(), 0);
        })
        .catch(() => {
          setLocationTone("warning");
          setLocationMessage("Apple Maps could not load here, so RescueMesh switched to the satellite fallback.");
          createLeafletMap("Satellite fallback");
        });
    } else {
      createLeafletMap("Satellite");
    }

    return () => {
      canceled = true;
      if (engineRef.current === "leaflet") {
        mapRef.current?.remove();
      }
      if (engineRef.current === "mapkit") {
        mapRef.current?.destroy();
      }
      mapRef.current = null;
      markerLayerRef.current = null;
      tileLayerRef.current = null;
      mapKitAnnotationsRef.current = [];
      userMarkerRef.current = null;
      fitTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      fitTimersRef.current = [];
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;

    if (engineRef.current === "leaflet") {
      if (tileLayerRef.current) {
        tileLayerRef.current.remove();
      }
      tileLayerRef.current = L.tileLayer(LEAFLET_TILES[mapMode].url, {
        maxZoom: 19,
        attribution: LEAFLET_TILES[mapMode].attribution
      }).addTo(mapRef.current);
      setMapProvider(APPLE_MAPS_ENABLED ? "Satellite fallback" : mapMode === "satellite" ? "Satellite" : "Street");
    }

    if (engineRef.current === "mapkit" && window.mapkit) {
      mapRef.current.mapType = mapKitType(window.mapkit, mapMode);
    }
  }, [mapMode]);

  useEffect(() => {
    if (!mapRef.current) return;

    if (engineRef.current === "mapkit" && window.mapkit) {
      const mapkit = window.mapkit;
      if (mapKitAnnotationsRef.current.length) {
        mapRef.current.removeAnnotations(mapKitAnnotationsRef.current);
      }
      const annotations = reports.map((report) => {
        const verificationLabel = getVerificationLabel(report, allReports);
        return new mapkit.MarkerAnnotation(new mapkit.Coordinate(report.latitude, report.longitude), {
          color: URGENCY_COLORS[report.urgency] || "#1f7a53",
          glyphText: CATEGORY_MARKERS[report.category] || "INFO",
          title: report.title,
          subtitle: report.locationAddress || report.locationName || verificationLabel
        });
      });
      mapKitAnnotationsRef.current = annotations;
      if (annotations.length) {
        mapRef.current.addAnnotations(annotations);
      }
      return;
    }

    if (!markerLayerRef.current) return;
    markerLayerRef.current.clearLayers();

    reports.forEach((report) => {
      const freshness = getFreshness(report);
      const confidence = calculateConfidence(report, allReports);
      const verificationLabel = getVerificationLabel(report, allReports);
      const marker = L.marker([report.latitude, report.longitude], {
        icon: L.divIcon({
          className: `mesh-marker ${URGENCY_CLASS[report.urgency]} marker-${verificationLabel.toLowerCase().replaceAll(" ", "-")} ${report.status === "Resolved" ? "marker-resolved" : ""} ${freshness.label === "Stale" ? "marker-stale" : ""}`,
          html: `<b>${CATEGORY_MARKERS[report.category] || "INFO"}</b><i></i>`,
          iconSize: [54, 38],
          iconAnchor: [27, 38]
        })
      });
      marker.bindPopup(popupHtml(report, verificationLabel, freshness, confidence));
      marker.addTo(markerLayerRef.current);
    });

  }, [reports, allReports]);

  useEffect(() => {
    if (!mapRef.current) return;
    fitTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    fitTimersRef.current = [120, 500, 1200].map((delay) => window.setTimeout(() => fitReports(), delay));
    return () => {
      fitTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      fitTimersRef.current = [];
    };
  }, [reportsKey]);

  function fitReports() {
    if (!mapRef.current) return;
    if (!reports.length) {
      if (engineRef.current === "leaflet") {
        mapRef.current.invalidateSize();
        mapRef.current.setView(WORLD_CENTER, 2, { animate: true });
      }
      if (engineRef.current === "mapkit" && window.mapkit) {
        mapRef.current.setCenterAnimated(new window.mapkit.Coordinate(WORLD_CENTER[0], WORLD_CENTER[1]), true);
      }
      return;
    }

    if (engineRef.current === "mapkit" && mapKitAnnotationsRef.current.length) {
      mapRef.current.showItems(mapKitAnnotationsRef.current, { animate: true });
      return;
    }

    const points = reports.map((report) => [report.latitude, report.longitude]);
    const uniquePoints = new Set(points.map((point) => point.join(",")));
    mapRef.current.invalidateSize();
    if (uniquePoints.size === 1) {
      mapRef.current.setView(points[0], 16, { animate: true });
      return;
    }
    mapRef.current.fitBounds(L.latLngBounds(points), { padding: [42, 42], maxZoom: 16, animate: true });
  }

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

        if (engineRef.current === "mapkit" && window.mapkit) {
          const mapkit = window.mapkit;
          if (userMarkerRef.current) {
            mapRef.current.removeAnnotation(userMarkerRef.current);
          }
          const coordinate = new mapkit.Coordinate(latLng[0], latLng[1]);
          userMarkerRef.current = new mapkit.MarkerAnnotation(coordinate, {
            color: "#2fb36d",
            glyphText: "YOU",
            title: "Your real device location"
          });
          mapRef.current.addAnnotation(userMarkerRef.current);
          mapRef.current.setCenterAnimated(coordinate, true);
          return;
        }

        if (userMarkerRef.current) {
          userMarkerRef.current.remove();
        }

        userMarkerRef.current = L.circleMarker(latLng, {
          radius: 10,
          color: "#ffffff",
          fillColor: "#2fb36d",
          fillOpacity: 0.95,
          weight: 4
        })
          .bindPopup("Your real device location")
          .addTo(mapRef.current);

        mapRef.current.setView(latLng, 16);
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
        <div className="segmented-control" aria-label="Map view">
          <button type="button" className={mapMode === "satellite" ? "active" : ""} onClick={() => setMapMode("satellite")}>
            <Satellite size={17} /> Satellite
          </button>
          <button type="button" className={mapMode === "street" ? "active" : ""} onClick={() => setMapMode("street")}>
            <Layers size={17} /> Street
          </button>
        </div>
        <button type="button" className="secondary" onClick={fitReports} disabled={!reports.length}>
          <Crosshair size={18} /> Fit Reports
        </button>
        <button type="button" className="secondary" onClick={locateDevice}>
          <LocateFixed size={18} /> My Location
        </button>
        {locationMessage && <span className={`location-message ${locationTone}`}>{locationMessage}</span>}
      </div>
      <div className="map-panel-wrap">
        <div className="map-panel" ref={containerRef} />
        <div className="map-overlay-card">
          <span>{mapProvider}</span>
          <strong>{reports.length} visible reports</strong>
          <small>{openReportCount} open · {criticalCount} critical</small>
        </div>
        <div className="map-legend" aria-label="Urgency legend">
          <span><i className="legend-dot low" /> Low</span>
          <span><i className="legend-dot medium" /> Medium</span>
          <span><i className="legend-dot high" /> High</span>
          <span><i className="legend-dot critical" /> Critical</span>
        </div>
        {!reports.length && (
          <div className="map-empty">
            <MapPinned size={24} />
            <strong>No mapped reports</strong>
            <span>Adjust filters or create a report with a location.</span>
          </div>
        )}
      </div>
    </div>
  );
}
