import { useSentinelStore } from "../../store/useSentinelStore";

const LAYERS = [
  {
    key: "aircraft",
    label: "Live Flights",
    icon: "✈",
    color: "#00d4ff",
    feedKey: "aircraft",
    source: "OpenSky Network",
  },
  {
    key: "ships",
    label: "Maritime Traffic",
    icon: "🚢",
    color: "#00ff88",
    feedKey: "ships",
    source: "MarineTraffic",
  },
  {
    key: "satellites",
    label: "Satellites",
    icon: "🛰",
    color: "#a78bfa",
    feedKey: "satellites",
    source: "CelesTrak",
  },
  {
    key: "persons",
    label: "Human Assets",
    icon: "👤",
    color: "#22d3ee",
    feedKey: null,
    source: "Local Person Dataset",
  },
  {
    key: "earthquakes",
    label: "Earthquakes (24h)",
    icon: "🌋",
    color: "#ffaa00",
    feedKey: "earthquakes",
    source: "USGS",
  },
  {
    key: "threats",
    label: "Cyber Threats",
    icon: "🔴",
    color: "#ff3366",
    feedKey: "threats",
    source: "ThreatFeed",
  },
  {
    key: "cyberIocs",
    label: "Cyber IOC URLs",
    icon: "🧪",
    color: "#f43f5e",
    feedKey: "cyber_iocs",
    source: "URLhaus",
  },
  {
    key: "weatherAlerts",
    label: "Weather Radar",
    icon: "🌩",
    color: "#f59e0b",
    feedKey: "weather",
    source: "NOAA NEXRAD (globe overlay)",
  },
  {
    key: "radarOverlay",
    label: "Radar Overlay",
    icon: "🛰",
    color: "#38bdf8",
    feedKey: null,
    source: "RainViewer tiles",
  },
  {
    key: "satelliteOverlay",
    label: "Satellite TrueColor",
    icon: "🛰",
    color: "#a78bfa",
    feedKey: null,
    source: "NASA GIBS",
  },
  {
    key: "news",
    label: "OSINT / News",
    icon: "📡",
    color: "#38bdf8",
    feedKey: "news",
    source: "OSINT Aggregator",
  },
  {
    key: "wildfires",
    label: "Wildfires (Active)",
    icon: "🔥",
    color: "#ff6b35",
    feedKey: "wildfires",
    source: "NASA EONET",
  },
  {
    key: "cameras",
    label: "Cameras / CCTV",
    icon: "📷",
    color: "#a78bfa",
    feedKey: "cameras",
    source: "OSM + Catalog",
  },
  {
    key: "conflicts",
    label: "Conflict Events",
    icon: "⚠",
    color: "#ff3366",
    feedKey: "conflicts",
    source: "GDELT GEO",
  },
  {
    key: "gpsJamming",
    label: "GPS Jamming",
    icon: "📶",
    color: "#ff6600",
    feedKey: null,
    source: "GPSJam.org",
  },
  {
    key: "routeOps",
    label: "RouteOps Overlay",
    icon: "🧭",
    color: "#00d4ff",
    feedKey: null,
    source: "SENTINEL RouteOps",
  },
];

function timeAgo(isoString) {
  if (!isoString) return "never";
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 5)  return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return "stale";
}

function countForLayer(key, store) {
  const map = {
    aircraft: "aircraft",
    ships: "ships",
    satellites: "satellites",
    persons: "persons",
    earthquakes: "earthquakes",
    threats: "threats",
    weatherAlerts: "weatherAlerts",
    news: "news",
    wildfires: "wildfires",
    cameras: "cameras",
    conflicts: "conflicts",
    cyberIocs: "cyberIocs",
    gpsJamming: "gpsJamming",
  };
  if (key === "routeOps") return store.routeOpsOverlay?.routes?.length || 0;
  return (store[map[key]] || []).length;
}

export default function LayerControls() {
  const store = useSentinelStore();
  const { activeLayers, toggleLayer, feedHealth } = store;

  return (
    <div className="sentinel-panel p-2">
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-[#00d4ff] text-[10px] font-bold tracking-widest">DATA LAYERS</span>
        <span className="text-slate-600 text-[9px]">—</span>
      </div>

      <div className="space-y-0">
        {LAYERS.map((l) => {
          const active = activeLayers[l.key];
          const health = l.feedKey ? (feedHealth?.[l.feedKey] || {}) : {};
          const count = countForLayer(l.key, store);
          const lastUpdate = health.updatedAt || health.lastFetch || null;
          const timeLabel = lastUpdate ? timeAgo(lastUpdate) : (active ? "loading..." : "never");

          return (
            <div
              key={l.key}
              className={`py-1.5 px-1 rounded transition-all ${active ? "" : "opacity-45"}`}
            >
              {/* Üst satır: ikon + isim + sayı + toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[13px] leading-none shrink-0">{l.icon}</span>
                  <span
                    className="text-[11px] font-mono font-semibold truncate"
                    style={{ color: active ? l.color : "#64748b" }}
                  >
                    {l.label}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-1">
                  {/* Sayı */}
                  <span className="text-[10px] font-mono w-8 text-right" style={{ color: active && count > 0 ? l.color : "#334155" }}>
                    {count > 0 ? (count >= 1000 ? (count / 1000).toFixed(1) + "K" : count) : "—"}
                  </span>
                  {/* ON/OFF buton — referans görüntüdeki kutu stili */}
                  <button
                    onClick={() => toggleLayer(l.key)}
                    className="text-[9px] font-bold tracking-widest px-1.5 py-0.5 rounded border transition-all"
                    style={
                      active
                        ? { color: l.color, borderColor: l.color, background: l.color + "22" }
                        : { color: "#334155", borderColor: "#1e293b", background: "transparent" }
                    }
                  >
                    {active ? "ON" : "OFF"}
                  </button>
                </div>
              </div>

              {/* Alt satır: kaynak · zaman */}
              <div className="flex items-center gap-1 mt-0.5 pl-5">
                <span className="text-[9px] text-slate-600 truncate">{l.source}</span>
                <span className="text-[9px] text-slate-700">·</span>
                <span className="text-[9px] text-slate-600 shrink-0">{timeLabel}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}