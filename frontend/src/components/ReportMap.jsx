import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair, Layers, LocateFixed, MapPinned, Satellite } from "lucide-react";
import { CATEGORY_MARKERS, URGENCY_CLASS, USA_BOUNDS, USA_CENTER, isInsideUsaBounds } from "../utils/constants";
import { calculateConfidence, getFreshness, getVerificationLabel } from "../utils/reportUtils";

const MAPKIT_TOKEN = import.meta.env.VITE_MAPKIT_JS_TOKEN;
const APPLE_MAPS_ENABLED = Boolean(MAPKIT_TOKEN?.trim());

const LEAFLET_TILES = {
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
  },
  street: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
  },
};

// Aligned with CSS design tokens
const URGENCY_COLORS = {
  Low:      "#2563a8",
  Medium:   "#b45309",
  High:     "#c2380d",
  Critical: "#9b1515",
};
const USA_LEAFLET_BOUNDS = L.latLngBounds(USA_BOUNDS);
const USA_DEFAULT_ZOOM = 4;

let mapKitLoadPromise;

function loadMapKit() {
  if (!APPLE_MAPS_ENABLED) return Promise.reject(new Error("MapKit token is not configured."));
  if (window.mapkit && window.__rescueMeshMapKitReady) return Promise.resolve(window.mapkit);
  if (mapKitLoadPromise) return mapKitLoadPromise;

  mapKitLoadPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector("script[data-rescuemesh-mapkit]");
    const script = existingScript || document.createElement("script");

    script.addEventListener("load", () => {
      if (!window.mapkit) { reject(new Error("MapKit JS did not load.")); return; }
      if (!window.__rescueMeshMapKitReady) {
        window.mapkit.init({ authorizationCallback(done) { done(MAPKIT_TOKEN); } });
        window.__rescueMeshMapKitReady = true;
      }
      resolve(window.mapkit);
    }, { once: true });

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

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function reportWithValidCoordinates(report) {
  const latitude = Number(report.latitude);
  const longitude = Number(report.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (!isInsideUsaBounds({ latitude, longitude })) return null;
  return { ...report, latitude, longitude };
}

function clampToUsaBounds([latitude, longitude]) {
  return [
    Math.min(Math.max(latitude, USA_BOUNDS[0][0]), USA_BOUNDS[1][0]),
    Math.min(Math.max(longitude, USA_BOUNDS[0][1]), USA_BOUNDS[1][1])
  ];
}

function setMapKitUsaRegion(map, mapkit, animate = false) {
  if (!map || !mapkit) return;
  const center = new mapkit.Coordinate(USA_CENTER[0], USA_CENTER[1]);
  if (mapkit.CoordinateSpan && mapkit.CoordinateRegion) {
    const span = new mapkit.CoordinateSpan(
      USA_BOUNDS[1][0] - USA_BOUNDS[0][0],
      USA_BOUNDS[1][1] - USA_BOUNDS[0][1]
    );
    const region = new mapkit.CoordinateRegion(center, span);
    if (typeof map.setRegionAnimated === "function") {
      map.setRegionAnimated(region, animate);
    } else {
      map.region = region;
    }
  } else if (typeof map.setCenterAnimated === "function") {
    map.setCenterAnimated(center, animate);
  } else {
    map.center = center;
  }
}

function markerClassName(report, verificationLabel, freshness) {
  const markerLabel = verificationLabel.toLowerCase().replaceAll(" ", "-");
  return [
    "mesh-marker",
    URGENCY_CLASS[report.urgency],
    `marker-${markerLabel}`,
    report.status === "Resolved" ? "marker-resolved" : "",
    freshness.label === "Stale" ? "marker-stale" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function liveMarkerClassName(incident) {
  return [
    "mesh-marker",
    "marker-live",
    URGENCY_CLASS[incident.urgency]
  ]
    .filter(Boolean)
    .join(" ");
}

function popupHtml(report, verificationLabel, freshness, confidence) {
  return `
    <div class="map-popup">
      <strong>${escapeHtml(report.title)}</strong>
      ${report.locationName ? `<span>${escapeHtml(report.locationName)}</span>` : ""}
      ${report.locationAddress ? `<small>${escapeHtml(report.locationAddress)}</small>` : ""}
      ${report.description ? `<p>${escapeHtml(report.description)}</p>` : ""}
      <dl>
        <dt>Urgency</dt><dd>${escapeHtml(report.urgency)}</dd>
        <dt>Status</dt><dd>${escapeHtml(report.status)}</dd>
        <dt>Verification</dt><dd>${escapeHtml(verificationLabel)}</dd>
        <dt>Freshness</dt><dd>${escapeHtml(freshness.label)}</dd>
        <dt>Confidence</dt><dd>${confidence}%</dd>
      </dl>
    </div>
  `;
}

function liveIncidentPopupHtml(incident) {
  return `
    <div class="map-popup live-popup">
      <strong>${escapeHtml(incident.title)}</strong>
      <span>${escapeHtml(incident.source || "Live source")}</span>
      ${incident.locationName ? `<small>${escapeHtml(incident.locationName)}</small>` : ""}
      ${incident.description ? `<p>${escapeHtml(incident.description)}</p>` : ""}
      <dl>
        <dt>Urgency</dt><dd>${escapeHtml(incident.urgency)}</dd>
        <dt>Status</dt><dd>${escapeHtml(incident.status)}</dd>
        <dt>Source</dt><dd>${escapeHtml(incident.eventType || "Official feed")}</dd>
      </dl>
    </div>
  `;
}

export default function ReportMap({ reports, allReports = reports, liveIncidents = [] }) {
  const mapRef = useRef(null);
  const engineRef = useRef(null);
  const containerRef = useRef(null);
  const markerLayerRef = useRef(null);
  const tileLayerRef = useRef(null);
  const mapKitAnnotationsRef = useRef([]);
  const userMarkerRef = useRef(null);
  const fitTimersRef = useRef([]);
  const resizeObserverRef = useRef(null);
  const resizeFrameRef = useRef(null);
  const userInteractedRef = useRef(false);
  const programmaticMoveRef = useRef(false);
  const programmaticMoveTimerRef = useRef(null);

  const [locationMessage, setLocationMessage] = useState("");
  const [locationTone, setLocationTone] = useState("info");
  const [mapMode, setMapMode] = useState("satellite");
  const [mapProvider, setMapProvider] = useState(APPLE_MAPS_ENABLED ? "Loading Apple Maps" : "Satellite");
  const [mapReadyVersion, setMapReadyVersion] = useState(0);

  const validReports = useMemo(() => reports.map(reportWithValidCoordinates).filter(Boolean), [reports]);
  const validAllReports = useMemo(() => allReports.map(reportWithValidCoordinates).filter(Boolean), [allReports]);
  const validLiveIncidents = useMemo(() => liveIncidents.map(reportWithValidCoordinates).filter(Boolean), [liveIncidents]);
  const mapItems = useMemo(
    () => [
      ...validReports.map((report) => ({ kind: "report", item: report })),
      ...validLiveIncidents.map((incident) => ({ kind: "live", item: incident }))
    ],
    [validLiveIncidents, validReports]
  );
  const openReportCount = validReports.filter((r) => r.status !== "Resolved").length;
  const criticalCount = mapItems.filter(({ item }) => item.urgency === "Critical" && item.status !== "Resolved").length;
  const reportsKey = useMemo(
    () => mapItems.map(({ kind, item }) => `${kind}:${item.report_id || item.incidentId}:${item.latitude}:${item.longitude}`).join("|"),
    [mapItems]
  );

  const invalidateMapSize = useCallback(() => {
    if (engineRef.current !== "leaflet" || !mapRef.current) return;
    if (resizeFrameRef.current) window.cancelAnimationFrame(resizeFrameRef.current);
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      mapRef.current?.invalidateSize({ debounceMoveend: true });
    });
  }, []);

  const finishProgrammaticMoveSoon = useCallback(() => {
    if (programmaticMoveTimerRef.current) window.clearTimeout(programmaticMoveTimerRef.current);
    programmaticMoveTimerRef.current = window.setTimeout(() => {
      programmaticMoveRef.current = false;
      programmaticMoveTimerRef.current = null;
    }, 250);
  }, []);

  const fitReports = useCallback(
    ({ animate = false, force = false } = {}) => {
      if (!mapRef.current) return;
      if (!force && userInteractedRef.current) return;

      programmaticMoveRef.current = true;

      if (!mapItems.length) {
        if (engineRef.current === "leaflet") {
          invalidateMapSize();
          mapRef.current.fitBounds(USA_LEAFLET_BOUNDS, { animate, padding: [12, 12] });
        }
        if (engineRef.current === "mapkit" && window.mapkit) {
          setMapKitUsaRegion(mapRef.current, window.mapkit, animate);
        }
        finishProgrammaticMoveSoon();
        return;
      }

      if (engineRef.current === "mapkit" && mapKitAnnotationsRef.current.length) {
        mapRef.current.showItems(mapKitAnnotationsRef.current, { animate });
        finishProgrammaticMoveSoon();
        return;
      }

      if (engineRef.current !== "leaflet") { finishProgrammaticMoveSoon(); return; }

      const points = mapItems.map(({ item }) => [item.latitude, item.longitude]);
      const uniquePoints = new Set(points.map((p) => p.join(",")));
      invalidateMapSize();
      if (uniquePoints.size === 1) {
        mapRef.current.setView(points[0], 16, { animate });
      } else {
        mapRef.current.fitBounds(L.latLngBounds(points), { padding: [42, 42], maxZoom: 16, animate });
      }
      finishProgrammaticMoveSoon();
    },
    [mapItems, invalidateMapSize, finishProgrammaticMoveSoon]
  );

  // Map init
  useEffect(() => {
    if (!containerRef.current) return;

    let destroyed = false;

    loadMapKit()
      .then((mapkit) => {
        if (destroyed || engineRef.current) return;
        engineRef.current = "mapkit";
        const map = new mapkit.Map(containerRef.current, {
          mapType: mapKitType(mapkit, mapMode),
          showsCompass: mapkit.FeatureVisibility?.Adaptive,
          showsScale: mapkit.FeatureVisibility?.Adaptive,
        });
        setMapKitUsaRegion(map, mapkit, false);
        map.addEventListener("drag", () => {
          if (!programmaticMoveRef.current) userInteractedRef.current = true;
        });
        map.addEventListener?.("region-change-end", () => {
          const center = map.center;
          if (!center || isInsideUsaBounds({ latitude: center.latitude, longitude: center.longitude })) return;
          const [latitude, longitude] = clampToUsaBounds([center.latitude, center.longitude]);
          map.setCenterAnimated?.(new mapkit.Coordinate(latitude, longitude), true);
        });
        mapRef.current = map;
        setMapProvider("Apple Maps");
        setMapReadyVersion((v) => v + 1);
      })
      .catch(() => {
        if (destroyed || engineRef.current) return;
        engineRef.current = "leaflet";
        const map = L.map(containerRef.current, {
          center: USA_CENTER,
          zoom: USA_DEFAULT_ZOOM,
          zoomControl: true,
          attributionControl: true,
          maxBounds: USA_LEAFLET_BOUNDS,
          maxBoundsViscosity: 1,
          minZoom: 4,
        });
        map.fitBounds(USA_LEAFLET_BOUNDS, { padding: [12, 12], animate: false });
        map.on("dragstart", () => {
          if (!programmaticMoveRef.current) userInteractedRef.current = true;
        });
        markerLayerRef.current = L.layerGroup().addTo(map);
        tileLayerRef.current = L.tileLayer(LEAFLET_TILES.satellite.url, {
          maxZoom: 19,
          attribution: LEAFLET_TILES.satellite.attribution,
          updateWhenIdle: true,
          keepBuffer: 2,
        }).addTo(map);
        mapRef.current = map;
        setMapProvider("Satellite");
        setMapReadyVersion((v) => v + 1);
      });

    resizeObserverRef.current = new ResizeObserver(invalidateMapSize);
    resizeObserverRef.current.observe(containerRef.current);

    return () => {
      destroyed = true;
      fitTimersRef.current.forEach((t) => window.clearTimeout(t));
      fitTimersRef.current = [];
      if (resizeFrameRef.current) window.cancelAnimationFrame(resizeFrameRef.current);
      if (programmaticMoveTimerRef.current) window.clearTimeout(programmaticMoveTimerRef.current);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      if (engineRef.current === "leaflet") mapRef.current?.remove();
      if (engineRef.current === "mapkit") mapRef.current?.destroy();
      mapRef.current = null;
      engineRef.current = null;
      markerLayerRef.current = null;
      tileLayerRef.current = null;
      mapKitAnnotationsRef.current = [];
      userMarkerRef.current = null;
    };
  }, [invalidateMapSize]);

  // Tile / map type switch
  useEffect(() => {
    if (!mapRef.current || !mapReadyVersion) return;
    if (engineRef.current === "leaflet") {
      if (tileLayerRef.current) tileLayerRef.current.remove();
      tileLayerRef.current = L.tileLayer(LEAFLET_TILES[mapMode].url, {
        maxZoom: 19,
        attribution: LEAFLET_TILES[mapMode].attribution,
        updateWhenIdle: true,
        keepBuffer: 2,
      }).addTo(mapRef.current);
      setMapProvider(APPLE_MAPS_ENABLED ? "Satellite fallback" : mapMode === "satellite" ? "Satellite" : "Street");
      invalidateMapSize();
    }
    if (engineRef.current === "mapkit" && window.mapkit) {
      mapRef.current.mapType = mapKitType(window.mapkit, mapMode);
    }
  }, [invalidateMapSize, mapMode, mapReadyVersion]);

  // Markers
  useEffect(() => {
    if (!mapRef.current || !mapReadyVersion) return;

    if (engineRef.current === "mapkit" && window.mapkit) {
      const mapkit = window.mapkit;
      if (mapKitAnnotationsRef.current.length) mapRef.current.removeAnnotations(mapKitAnnotationsRef.current);
      const annotations = mapItems.map(({ kind, item }) => {
        const verificationLabel = kind === "report" ? getVerificationLabel(item, validAllReports) : "Live source";
        return new mapkit.MarkerAnnotation(new mapkit.Coordinate(item.latitude, item.longitude), {
          color: kind === "live" ? "#0f766e" : URGENCY_COLORS[item.urgency] || "#1c7a4f",
          glyphText: kind === "live" ? "LIVE" : CATEGORY_MARKERS[item.category] || "INFO",
          title: item.title,
          subtitle: item.locationAddress || item.locationName || verificationLabel,
        });
      });
      mapKitAnnotationsRef.current = annotations;
      if (annotations.length) mapRef.current.addAnnotations(annotations);
      return;
    }

    if (!markerLayerRef.current) return;
    markerLayerRef.current.clearLayers();

    validReports.forEach((report) => {
      const freshness = getFreshness(report);
      const confidence = calculateConfidence(report, validAllReports);
      const verificationLabel = getVerificationLabel(report, validAllReports);
      const marker = L.marker([report.latitude, report.longitude], {
        icon: L.divIcon({
          className: markerClassName(report, verificationLabel, freshness),
          html: `<b>${escapeHtml(CATEGORY_MARKERS[report.category] || "INFO")}</b><i></i>`,
          iconSize: [54, 38],
          iconAnchor: [27, 38],
        }),
        riseOnHover: true,
      });
      marker.bindPopup(popupHtml(report, verificationLabel, freshness, confidence));
      marker.addTo(markerLayerRef.current);
    });

    validLiveIncidents.forEach((incident) => {
      const marker = L.marker([incident.latitude, incident.longitude], {
        icon: L.divIcon({
          className: liveMarkerClassName(incident),
          html: "<b>LIVE</b><i></i>",
          iconSize: [58, 42],
          iconAnchor: [29, 42],
        }),
        riseOnHover: true,
      });
      marker.bindPopup(liveIncidentPopupHtml(incident));
      marker.addTo(markerLayerRef.current);
    });
  }, [validReports, validAllReports, validLiveIncidents, mapItems, mapReadyVersion]);

  // Fit
  useEffect(() => {
    if (!mapRef.current || !mapReadyVersion) return;
    fitTimersRef.current.forEach((t) => window.clearTimeout(t));
    fitTimersRef.current = [60, 260].map((delay) =>
      window.setTimeout(() => fitReports({ animate: false }), delay)
    );
    return () => {
      fitTimersRef.current.forEach((t) => window.clearTimeout(t));
      fitTimersRef.current = [];
    };
  }, [fitReports, mapReadyVersion, reportsKey]);

  function locateDevice() {
    if (!navigator.geolocation) {
      setLocationTone("warning");
      setLocationMessage("This browser does not support device location.");
      return;
    }
    setLocationTone("info");
    setLocationMessage("Requesting device location...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latLng = [position.coords.latitude, position.coords.longitude];
        if (!isInsideUsaBounds({ latitude: latLng[0], longitude: latLng[1] })) {
          setLocationTone("warning");
          setLocationMessage("Your device location is outside the U.S. operating area.");
          fitReports({ animate: true, force: true });
          return;
        }
        setLocationTone("success");
        setLocationMessage(`Device location: ${latLng[0].toFixed(5)}, ${latLng[1].toFixed(5)}`);
        userInteractedRef.current = true;
        programmaticMoveRef.current = true;

        if (engineRef.current === "mapkit" && window.mapkit) {
          const mapkit = window.mapkit;
          if (userMarkerRef.current) mapRef.current.removeAnnotation(userMarkerRef.current);
          const coordinate = new mapkit.Coordinate(latLng[0], latLng[1]);
          userMarkerRef.current = new mapkit.MarkerAnnotation(coordinate, {
            color: "#2fb36d",
            glyphText: "YOU",
            title: "Your device location",
          });
          mapRef.current.addAnnotation(userMarkerRef.current);
          mapRef.current.setCenterAnimated(coordinate, true);
          finishProgrammaticMoveSoon();
          return;
        }

        if (userMarkerRef.current) userMarkerRef.current.remove();
        userMarkerRef.current = L.circleMarker(latLng, {
          radius: 10,
          color: "#ffffff",
          fillColor: "#2fb36d",
          fillOpacity: 0.95,
          weight: 4,
        })
          .bindPopup("Your device location")
          .addTo(mapRef.current);
        mapRef.current.setView(latLng, 16, { animate: true });
        finishProgrammaticMoveSoon();
      },
      (error) => {
        setLocationTone("warning");
        setLocationMessage(
          error.code === error.PERMISSION_DENIED
            ? "Location permission denied."
            : "Could not get device location."
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  }

  function fitVisibleReports() {
    userInteractedRef.current = false;
    fitReports({ animate: true, force: true });
  }

  return (
    <div className="map-shell">
      <div className="map-toolbar">
        <div className="segmented-control" aria-label="Map view">
          <button
            type="button"
            className={mapMode === "satellite" ? "active" : ""}
            onClick={() => setMapMode("satellite")}
          >
            <Satellite size={15} /> Satellite
          </button>
          <button
            type="button"
            className={mapMode === "street" ? "active" : ""}
            onClick={() => setMapMode("street")}
          >
            <Layers size={15} /> Street
          </button>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={fitVisibleReports}
          disabled={!mapItems.length || !mapReadyVersion}
        >
          <Crosshair size={16} /> Fit Map
        </button>
        <button
          type="button"
          className="secondary"
          onClick={locateDevice}
          disabled={!mapReadyVersion}
        >
          <LocateFixed size={16} /> My Location
        </button>
        {locationMessage && (
          <span className={`location-message ${locationTone}`}>{locationMessage}</span>
        )}
      </div>

      <div className="map-panel-wrap">
        <div className="map-panel" ref={containerRef} />
        <div className="map-overlay-card">
          <span>{mapProvider}</span>
          <strong>{validReports.length} reports · {validLiveIncidents.length} live</strong>
          <small>{openReportCount} open / {criticalCount} critical</small>
        </div>
        <div className="map-legend" aria-label="Urgency legend">
          <span><i className="legend-dot low" /> Low</span>
          <span><i className="legend-dot medium" /> Medium</span>
          <span><i className="legend-dot high" /> High</span>
          <span><i className="legend-dot critical" /> Critical</span>
        </div>
        {!mapItems.length && (
          <div className="map-empty">
            <MapPinned size={22} />
            <strong>No mapped reports</strong>
            <span>Adjust filters or add a report with a location.</span>
          </div>
        )}
      </div>
    </div>
  );
}
