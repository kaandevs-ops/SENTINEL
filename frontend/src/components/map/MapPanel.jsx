import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import { useSentinelStore } from "../../store/useSentinelStore";
import "leaflet/dist/leaflet.css";

function AircraftLayer({ aircraft }) {
  return aircraft.slice(0, 2000).map((a) => (
    <CircleMarker
      key={a.id}
      center={[a.latitude, a.longitude]}
      radius={2}
      pathOptions={{ color: "#00d4ff", fillColor: "#00d4ff", fillOpacity: 0.8, weight: 0 }}
    >
      <Tooltip>
        <div className="text-xs">
          <div className="font-bold">{a.callsign}</div>
          <div>{a.country}</div>
          <div>Alt: {Math.round(a.altitude)}m | {a.speed}km/h</div>
        </div>
      </Tooltip>
    </CircleMarker>
  ));
}

function EarthquakeLayer({ earthquakes }) {
  return earthquakes.map((eq) => {
    if (!eq.latitude || !eq.longitude) return null;
    const r = Math.max(4, (eq.magnitude || 0) * 3);
    const color = eq.magnitude >= 6 ? "#ff3366" : eq.magnitude >= 4 ? "#ffaa00" : "#ffdd00";
    return (
      <CircleMarker
        key={eq.id}
        center={[eq.latitude, eq.longitude]}
        radius={r}
        pathOptions={{ color, fillColor: color, fillOpacity: 0.5, weight: 1 }}
      >
        <Tooltip>
          <div className="text-xs">
            <div className="font-bold">M{eq.magnitude?.toFixed(1)} Earthquake</div>
            <div>{eq.place}</div>
            <div>Depth: {eq.depth_km?.toFixed(0)}km</div>
          </div>
        </Tooltip>
      </CircleMarker>
    );
  });
}

function ThreatLayer({ threats }) {
  return threats.filter(t => t.latitude && t.longitude).map((t) => (
    <CircleMarker
      key={t.id}
      center={[t.latitude, t.longitude]}
      radius={5}
      pathOptions={{ color: "#ff3366", fillColor: "#ff3366", fillOpacity: 0.6, weight: 1 }}
    >
      <Tooltip>
        <div className="text-xs">
          <div className="font-bold">Cyber Threat</div>
          <div>{t.ip}</div>
          <div>{t.malware}</div>
        </div>
      </Tooltip>
    </CircleMarker>
  ));
}

export default function MapPanel() {
  const { aircraft, earthquakes, threats, activeLayers } = useSentinelStore();

  return (
    <div className="w-full h-full relative">
      <MapContainer
        center={[20, 0]}
        zoom={3}
        style={{ width: "100%", height: "100%", background: "#0a0e1a" }}
        zoomControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com">CARTO</a>'
        />
        {activeLayers.aircraft    && <AircraftLayer   aircraft={aircraft} />}
        {activeLayers.earthquakes && <EarthquakeLayer earthquakes={earthquakes} />}
        {activeLayers.threats     && <ThreatLayer     threats={threats} />}
      </MapContainer>

      {/* Overlay stats */}
      <div className="absolute top-2 left-2 z-[1000] flex gap-2">
        <div className="bg-[#0d1424]/90 border border-[#1a2744] rounded px-2 py-1 text-xs text-[#00d4ff]">
          ✈️ {aircraft.length.toLocaleString()} live
        </div>
        <div className="bg-[#0d1424]/90 border border-[#1a2744] rounded px-2 py-1 text-xs text-[#ffaa00]">
          🌍 {earthquakes.length} seismic
        </div>
        <div className="bg-[#0d1424]/90 border border-[#1a2744] rounded px-2 py-1 text-xs text-[#ff3366]">
          🔴 {threats.length} threats
        </div>
      </div>
    </div>
  );
}
