import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, LocateFixed, Maximize2 } from "lucide-react";
import { CATEGORY_MARKERS, WORLD_CENTER } from "../utils/constants";
import { calculateConfidence, getFreshness, getVerificationLabel } from "../utils/reportUtils";

const GOOGLE_MAPS_SCRIPT_ID = "rescuemesh-google-maps";

function loadGoogleMaps(apiKey) {
  if (window.google?.maps) {
    return Promise.resolve(window.google.maps);
  }

  const existingScript = document.getElementById(GOOGLE_MAPS_SCRIPT_ID);
  if (existingScript) {
    return new Promise((resolve, reject) => {
      existingScript.addEventListener("load", () => resolve(window.google.maps), { once: true });
      existingScript.addEventListener("error", reject, { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google.maps);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function popupHtml(report, allReports) {
  const freshness = getFreshness(report);
  const confidence = calculateConfidence(report, allReports);
  const verificationLabel = getVerificationLabel(report, allReports);

  return `
    <div class="google-map-popup">
      <strong>${report.title}</strong>
      <p>${report.description || ""}</p>
      <p><b>Category:</b> ${report.category}</p>
      <p><b>Urgency:</b> ${report.urgency}</p>
      <p><b>Status:</b> ${report.status}</p>
      <p><b>Verification:</b> ${verificationLabel}</p>
      <p><b>Freshness:</b> ${freshness.label}</p>
      <p><b>Confidence:</b> ${confidence}%</p>
      <p><b>Time:</b> ${new Date(report.timestamp).toLocaleString()}</p>
    </div>
  `;
}

export default function ReportMap({ reports, allReports = reports }) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const panoramaContainerRef = useRef(null);
  const panoramaRef = useRef(null);
  const streetViewServiceRef = useRef(null);
  const markersRef = useRef([]);
  const userMarkerRef = useRef(null);
  const infoWindowRef = useRef(null);
  const hasAutoFitRef = useRef(false);
  const userMovedMapRef = useRef(false);
  const programmaticMoveRef = useRef(false);
  const previousReportKeyRef = useRef("");
  const [mapState, setMapState] = useState(apiKey ? "loading" : "missing-key");
  const [selectedReport, setSelectedReport] = useState(null);
  const [streetViewMessage, setStreetViewMessage] = useState("");
  const [locationMessage, setLocationMessage] = useState("");
  const [locationTone, setLocationTone] = useState("info");

  const reportKey = useMemo(() => reports.map((report) => report.report_id).sort().join("|"), [reports]);

  useEffect(() => {
    if (!apiKey || !mapContainerRef.current || mapRef.current) return;

    let cancelled = false;
    loadGoogleMaps(apiKey)
      .then((maps) => {
        if (cancelled || !mapContainerRef.current) return;

        const map = new maps.Map(mapContainerRef.current, {
          center: { lat: WORLD_CENTER[0], lng: WORLD_CENTER[1] },
          zoom: 2,
          mapTypeControl: true,
          fullscreenControl: true,
          streetViewControl: true,
          zoomControl: true,
          gestureHandling: "greedy",
          clickableIcons: false,
        });

        const panorama = new maps.StreetViewPanorama(panoramaContainerRef.current, {
          position: { lat: WORLD_CENTER[0], lng: WORLD_CENTER[1] },
          pov: { heading: 0, pitch: 0 },
          visible: false,
          addressControl: true,
          fullscreenControl: true,
          linksControl: true,
          panControl: true,
          zoomControl: true,
        });

        map.setStreetView(panorama);
        mapRef.current = map;
        panoramaRef.current = panorama;
        streetViewServiceRef.current = new maps.StreetViewService();
        infoWindowRef.current = new maps.InfoWindow();

        map.addListener("dragstart", () => {
          if (!programmaticMoveRef.current) userMovedMapRef.current = true;
        });
        map.addListener("zoom_changed", () => {
          if (!programmaticMoveRef.current) userMovedMapRef.current = true;
        });

        setMapState("ready");
      })
      .catch(() => setMapState("error"));

    return () => {
      cancelled = true;
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
      userMarkerRef.current?.setMap(null);
      mapRef.current = null;
      panoramaRef.current = null;
      streetViewServiceRef.current = null;
      infoWindowRef.current = null;
    };
  }, [apiKey]);

  function fitReports({ force = false } = {}) {
    if (!mapRef.current || !window.google?.maps) return;
    const maps = window.google.maps;

    if (!reports.length) {
      programmaticMoveRef.current = true;
      mapRef.current.setCenter({ lat: WORLD_CENTER[0], lng: WORLD_CENTER[1] });
      mapRef.current.setZoom(2);
      programmaticMoveRef.current = false;
      return;
    }

    programmaticMoveRef.current = true;
    if (reports.length === 1) {
      const report = reports[0];
      mapRef.current.setCenter({ lat: Number(report.latitude), lng: Number(report.longitude) });
      mapRef.current.setZoom(force ? 16 : Math.max(mapRef.current.getZoom() || 14, 14));
    } else {
      const bounds = new maps.LatLngBounds();
      reports.forEach((report) => bounds.extend({ lat: Number(report.latitude), lng: Number(report.longitude) }));
      mapRef.current.fitBounds(bounds, 48);
    }
    window.setTimeout(() => {
      programmaticMoveRef.current = false;
    }, 0);
  }

  useEffect(() => {
    if (mapState !== "ready" || !mapRef.current || !window.google?.maps) return;
    const maps = window.google.maps;

    markersRef.current.forEach((marker) => marker.setMap(null));
    markersRef.current = reports.map((report) => {
      const marker = new maps.Marker({
        map: mapRef.current,
        position: { lat: Number(report.latitude), lng: Number(report.longitude) },
        title: report.title,
        label: {
          text: CATEGORY_MARKERS[report.category] || "INFO",
          color: "#ffffff",
          fontWeight: "800",
          fontSize: "11px",
        },
      });

      marker.addListener("click", () => {
        setSelectedReport(report);
        setStreetViewMessage("");
        infoWindowRef.current.setContent(popupHtml(report, allReports));
        infoWindowRef.current.open({ map: mapRef.current, anchor: marker });
      });

      return marker;
    });

    const reportsChanged = previousReportKeyRef.current !== reportKey;
    previousReportKeyRef.current = reportKey;

    if (!hasAutoFitRef.current || (reportsChanged && !userMovedMapRef.current)) {
      fitReports();
      hasAutoFitRef.current = true;
    }
  }, [reports, allReports, reportKey, mapState]);

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
        const latLng = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setLocationTone("success");
        setLocationMessage(`Showing real device location: ${latLng.lat.toFixed(5)}, ${latLng.lng.toFixed(5)}`);

        if (userMarkerRef.current) {
          userMarkerRef.current.setMap(null);
        }

        userMarkerRef.current = new window.google.maps.Marker({
          map: mapRef.current,
          position: latLng,
          title: "Your real device location",
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#2fb36d",
            fillOpacity: 1,
            strokeColor: "#155b3d",
            strokeWeight: 3,
          },
        });

        programmaticMoveRef.current = true;
        mapRef.current.setCenter(latLng);
        mapRef.current.setZoom(15);
        window.setTimeout(() => {
          programmaticMoveRef.current = false;
        }, 0);
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
        timeout: 10000,
      }
    );
  }

  function openStreetViewForSelected() {
    if (!selectedReport || !streetViewServiceRef.current || !panoramaRef.current) return;
    const position = { lat: Number(selectedReport.latitude), lng: Number(selectedReport.longitude) };
    setStreetViewMessage("Searching for nearby Google Street View imagery...");

    streetViewServiceRef.current.getPanorama(
      {
        location: position,
        radius: 80,
        source: window.google.maps.StreetViewSource.OUTDOOR,
      },
      (data, status) => {
        if (status !== "OK" || !data?.location?.latLng) {
          panoramaRef.current.setVisible(false);
          setStreetViewMessage("No nearby Street View imagery was found for this report.");
          return;
        }

        panoramaRef.current.setPosition(data.location.latLng);
        panoramaRef.current.setPov({ heading: 0, pitch: 0 });
        panoramaRef.current.setVisible(true);
        setStreetViewMessage(`Street View opened near ${selectedReport.title}.`);
      }
    );
  }

  return (
    <div className="map-shell">
      <div className="map-toolbar">
        <button type="button" className="secondary" onClick={locateDevice} disabled={mapState !== "ready"}>
          <LocateFixed size={18} /> Show My Real Location
        </button>
        <button type="button" className="secondary" onClick={() => fitReports({ force: true })} disabled={!reports.length || mapState !== "ready"}>
          <Maximize2 size={18} /> Fit Reports
        </button>
        <button type="button" className="secondary" onClick={openStreetViewForSelected} disabled={!selectedReport || mapState !== "ready"}>
          <Eye size={18} /> Street View
        </button>
        {selectedReport && <span className="location-message">Selected: {selectedReport.title}</span>}
        {locationMessage && <span className={`location-message ${locationTone}`}>{locationMessage}</span>}
      </div>
      <div className="google-map-grid">
        <div className="map-panel google-map-panel" ref={mapContainerRef}>
          {mapState === "missing-key" && (
            <div className="map-empty-state">
              Add `VITE_GOOGLE_MAPS_API_KEY` to `frontend/.env` to enable Google Maps and Street View.
            </div>
          )}
          {mapState === "loading" && <div className="map-empty-state">Loading Google Maps...</div>}
          {mapState === "error" && <div className="map-empty-state">Google Maps could not load. Check the browser API key and billing setup.</div>}
        </div>
        <div className="street-view-panel">
          <div ref={panoramaContainerRef} className="street-view-canvas" />
          <p>{streetViewMessage || "Select a report marker, then click Street View to inspect nearby imagery."}</p>
        </div>
      </div>
    </div>
  );
}
