import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useSentinelStore } from "../../store/useSentinelStore";

export default function GlobePanel() {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({});
  const {
    aircraft,
    ships,
    satellites,
    earthquakes,
    weatherAlerts,
    news,
    threats,
    activeLayers,
  } = useSentinelStore();

  // Map init — bir kez
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [20, 10],
      zoom: 3,
      zoomControl: true,
      attributionControl: false,
      preferCanvas: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Aircraft layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (layersRef.current.aircraft) { map.removeLayer(layersRef.current.aircraft); layersRef.current.aircraft = null; }
    if (!activeLayers.aircraft || !aircraft.length) return;

    const renderer = L.canvas({ padding: 0.5 });
    const layer = L.layerGroup();

    aircraft.forEach((a) => {
      if (a.latitude == null || a.longitude == null) return;
      const circle = L.circleMarker([a.latitude, a.longitude], {
        radius: 2,
        fillColor: a.on_ground ? "#336688" : "#00d4ff",
        fillOpacity: 0.85,
        stroke: false,
        renderer,
      });
      circle.bindPopup(
        `<div style="background:#0d1424;color:#e2e8f0;padding:8px;font-size:11px;min-width:150px">
          <b style="color:#00d4ff">${a.callsign || a.id}</b><br/>
          ${a.country || "Unknown"}<br/>
          Alt: ${Math.round(a.altitude || 0).toLocaleString()}m &nbsp; ${a.speed || 0} km/h
        </div>`,
        { className: "sentinel-popup" }
      );
      layer.addLayer(circle);
    });

    layer.addTo(map);
    layersRef.current.aircraft = layer;
  }, [aircraft, activeLayers.aircraft]);

  // Ships layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (layersRef.current.ships) { map.removeLayer(layersRef.current.ships); layersRef.current.ships = null; }
    if (!activeLayers.ships || !ships.length) return;

    const layer = L.layerGroup();
    ships.forEach((s) => {
      if (s.latitude == null || s.longitude == null) return;
      const circle = L.circleMarker([s.latitude, s.longitude], {
        radius: 4, fillColor: "#00ff88", fillOpacity: 0.9, color: "#00ff88", weight: 1,
      });
      circle.bindPopup(
        `<div style="background:#0d1424;color:#e2e8f0;padding:8px;font-size:11px">
          <b style="color:#00ff88">🚢 ${s.name || s.mmsi || "Ship"}</b><br/>
          ${s.flag || s.country || ""} &nbsp; ${s.speed || 0} kn
        </div>`,
        { className: "sentinel-popup" }
      );
      layer.addLayer(circle);
    });

    layer.addTo(map);
    layersRef.current.ships = layer;
  }, [ships, activeLayers.ships]);

  // Satellites layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (layersRef.current.satellites) { map.removeLayer(layersRef.current.satellites); layersRef.current.satellites = null; }
    if (!activeLayers.satellites || !satellites.length) return;

    const layer = L.layerGroup();
    satellites.forEach((sat) => {
      if (sat.latitude == null || sat.longitude == null) return;
      const circle = L.circleMarker([sat.latitude, sat.longitude], {
        radius: 3,
        fillColor: "#a78bfa",
        fillOpacity: 0.85,
        color: "#a78bfa",
        weight: 1,
      });
      circle.bindPopup(
        `<div style="background:#0d1424;color:#e2e8f0;padding:8px;font-size:11px;min-width:170px">
          <b style="color:#a78bfa">🛰️ ${sat.name || "Satellite"}</b><br/>
          Alt: ${Math.round(sat.altitude || 0).toLocaleString()} km<br/>
          Period: ${(sat.period_min || 0).toLocaleString()} min
        </div>`,
        { className: "sentinel-popup" }
      );
      layer.addLayer(circle);
    });

    layer.addTo(map);
    layersRef.current.satellites = layer;
  }, [satellites, activeLayers.satellites]);

  // Earthquakes layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (layersRef.current.earthquakes) { map.removeLayer(layersRef.current.earthquakes); layersRef.current.earthquakes = null; }
    if (!activeLayers.earthquakes || !earthquakes.length) return;

    const layer = L.layerGroup();
    earthquakes.forEach((eq) => {
      if (eq.latitude == null || eq.longitude == null) return;
      const mag = eq.magnitude || 2;
      const color = mag >= 6 ? "#ff2244" : mag >= 5 ? "#ff6600" : mag >= 4 ? "#ffaa00" : "#ffdd44";
      const circle = L.circleMarker([eq.latitude, eq.longitude], {
        radius: Math.max(mag * 3, 5), fillColor: color, fillOpacity: 0.5, color, weight: 1.5,
      });
      circle.bindPopup(
        `<div style="background:#0d1424;color:#e2e8f0;padding:8px;font-size:11px">
          <b style="color:${color}">M${mag.toFixed(1)}</b> ${eq.place || ""}<br/>
          Depth: ${(eq.depth_km || 0).toFixed(1)}km
        </div>`,
        { className: "sentinel-popup" }
      );
      layer.addLayer(circle);
    });

    layer.addTo(map);
    layersRef.current.earthquakes = layer;
  }, [earthquakes, activeLayers.earthquakes]);

  // News layer (country-level geocoded or precise when available)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (layersRef.current.news) { map.removeLayer(layersRef.current.news); layersRef.current.news = null; }
    if (!activeLayers.news || !news.length) return;

    const layer = L.layerGroup();
    news.forEach((n) => {
      if (n.latitude == null || n.longitude == null) return;
      const circle = L.circleMarker([n.latitude, n.longitude], {
        radius: 5,
        fillColor: "#00d4ff",
        fillOpacity: 0.25,
        color: "#00d4ff",
        weight: 1,
      });
      circle.bindPopup(
        `<div style="background:#0d1424;color:#e2e8f0;padding:8px;font-size:11px;min-width:240px">
          <b style="color:#00d4ff">📰 ${(n.title || "News").replace(/</g, "&lt;")}</b><br/>
          <span style="color:#94a3b8">${(n.source || "").slice(0, 60)} ${n.country ? "· " + n.country.toUpperCase() : ""}</span><br/>
          <a href="${(n.url || "").replace(/"/g, "%22")}" target="_blank" rel="noreferrer" style="color:#a78bfa;text-decoration:underline">open</a>
        </div>`,
        { className: "sentinel-popup" }
      );
      layer.addLayer(circle);
    });

    layer.addTo(map);
    layersRef.current.news = layer;
  }, [news, activeLayers.news]);

  // Weather alerts layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (layersRef.current.weatherAlerts) { map.removeLayer(layersRef.current.weatherAlerts); layersRef.current.weatherAlerts = null; }
    if (!activeLayers.weatherAlerts || !weatherAlerts.length) return;

    const layer = L.layerGroup();
    weatherAlerts.forEach((w) => {
      if (w.latitude == null || w.longitude == null) return;
      const severity = (w.severity || "Unknown").toLowerCase();
      const color =
        severity === "extreme" ? "#ff3366" :
        severity === "severe" ? "#ffaa00" :
        severity === "moderate" ? "#a78bfa" :
        "#64748b";
      const circle = L.circleMarker([w.latitude, w.longitude], {
        radius: 6,
        fillColor: color,
        fillOpacity: 0.35,
        color,
        weight: 1.5,
      });
      circle.bindPopup(
        `<div style="background:#0d1424;color:#e2e8f0;padding:8px;font-size:11px;min-width:200px">
          <b style="color:${color}">🌪️ ${w.event || "Weather Alert"}</b><br/>
          <span style="color:#94a3b8">${w.severity || ""}</span><br/>
          ${(w.area || "").slice(0, 160)}
        </div>`,
        { className: "sentinel-popup" }
      );
      layer.addLayer(circle);
    });

    layer.addTo(map);
    layersRef.current.weatherAlerts = layer;
  }, [weatherAlerts, activeLayers.weatherAlerts]);

  return (
    <div className="w-full h-full relative">
      <div ref={containerRef} style={{ width: "100%", height: "100%", background: "#050a14" }} />

      <div className="absolute top-2 left-12 z-[1000] flex gap-2 pointer-events-none">
        <div className="bg-[#0d1424]/90 border border-[#1a2744] rounded px-2 py-1 text-xs text-[#00d4ff]">✈️ {aircraft.length.toLocaleString()}</div>
        {activeLayers.ships && ships.length > 0 && <div className="bg-[#0d1424]/90 border border-[#1a2744] rounded px-2 py-1 text-xs text-[#00ff88]">🚢 {ships.length}</div>}
        {activeLayers.satellites && satellites.length > 0 && <div className="bg-[#0d1424]/90 border border-[#1a2744] rounded px-2 py-1 text-xs text-[#a78bfa]">🛰️ {satellites.length}</div>}
        <div className="bg-[#0d1424]/90 border border-[#1a2744] rounded px-2 py-1 text-xs text-[#ffaa00]">🌍 {earthquakes.length}</div>
        <div className="bg-[#0d1424]/90 border border-[#1a2744] rounded px-2 py-1 text-xs text-[#ff3366]">🔴 {threats.length}</div>
      </div>

      <style>{`
        .sentinel-popup .leaflet-popup-content-wrapper { background:#0d1424; border:1px solid #1a2744; border-radius:4px; box-shadow:0 0 20px rgba(0,212,255,0.15); padding:0; }
        .sentinel-popup .leaflet-popup-tip { background:#1a2744; }
        .sentinel-popup .leaflet-popup-content { margin:0; }
        .leaflet-container { background:#050a14 !important; }
        .leaflet-control-zoom a { background:#0d1424 !important; color:#00d4ff !important; border-color:#1a2744 !important; }
      `}</style>
    </div>
  );
}
