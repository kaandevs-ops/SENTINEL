import { useState, useEffect, useCallback } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useSentinelStore } from "./store/useSentinelStore";
import StatsPanel from "./components/panels/StatsPanel";
import OperationalPicturePanel from "./components/panels/OperationalPicturePanel";
import PersonsPanel from "./components/panels/PersonsPanel";
import PersonsGraphPanel from "./components/panels/PersonsGraphPanel";
import DataIntegrityPanel from "./components/panels/DataIntegrityPanel";
import LayerControls from "./components/panels/LayerControls";
import AlertPanel from "./components/panels/AlertPanel";
import AIChat from "./components/chat/AIChat";
import PlaybackPanel from "./components/PlaybackPanel";
import CesiumGlobePanel from "./components/map/CesiumGlobePanel";
import AIProviderPanel from "./components/panels/AIProviderPanel";
import GeoSeerPanel from "./components/panels/GeoSeerPanel";
import RouteOpsPanel from "./components/panels/RouteOpsPanel";
import ThemeControls from "./components/panels/ThemeControls";
import NewsDock from "./components/panels/NewsDock";
import { Brain, Settings, Radio, Lock, Image, Route } from "lucide-react";

// ── Sabit konum listesi (referans görselden) ─────────────────────────────
const CITY_LOCATIONS = [
  { label: "Austin",        lat: 30.267,  lon: -97.743 },
  { label: "San Francisco", lat: 37.775,  lon: -122.418 },
  { label: "New York",      lat: 40.713,  lon: -74.006 },
  { label: "Tokyo",         lat: 35.689,  lon: 139.692 },
  { label: "London",        lat: 51.507,  lon: -0.128 },
  { label: "Paris",         lat: 48.857,  lon: 2.347 },
  { label: "Dubai",         lat: 25.205,  lon: 55.270 },
  { label: "Washington DC", lat: 38.907,  lon: -77.037 },
];

// ── Stil preset listesi (referans görselden) ──────────────────────────────
const STYLE_PRESETS = [
  { key: "normal", label: "Normal", icon: "○", color: "#00d4ff" },
  { key: "crt",    label: "CRT",    icon: "■", color: "#00ff88" },
  { key: "nvg",    label: "NVG",    icon: "☾", color: "#39ff14" },
  { key: "flir",   label: "FLIR",   icon: "✕", color: "#ff6600" },
  { key: "anime",  label: "Anime",  icon: "✦", color: "#f472b6" },
  { key: "noir",   label: "Noir",   icon: "◑", color: "#aaaaaa" },
  { key: "snow",   label: "Snow",   icon: "❄", color: "#bae6fd" },
  { key: "ai",     label: "AI Edit",icon: "●", color: "#a78bfa" },
];

// ── UTC saat ─────────────────────────────────────────────────────────────
function UtcClock() {
  const [time, setTime] = useState(new Date().toUTCString().slice(17, 25));
  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toUTCString().slice(17, 25)), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="font-mono text-[#00d4ff] text-xs tracking-widest">{time} UTC</span>
  );
}

// ── Ana bileşen ──────────────────────────────────────────────────────────
export default function App() {
  const { sendQuery } = useWebSocket();
  const { wsStatus, stats, alerts, mapTheme, setMapTheme } = useSentinelStore();
  const [showChat, setShowChat]           = useState(false);
  const [showAISettings, setShowAISettings] = useState(false);
  const [showGeoSeer, setShowGeoSeer]     = useState(false);
  const [showRouteOps, setShowRouteOps]   = useState(false);
  const [isLive, setIsLive]               = useState(true);
  const [activeCity, setActiveCity]       = useState(null);

  const unreadAlerts = alerts.filter((a) => !a.is_read).length;

  // CesiumGlobePanel'e fly-to iletmek için ref tabanlı callback
  // CesiumGlobePanel window.__sentinelFlyTo fonksiyonunu register edecek
  const handleCityClick = useCallback((city) => {
    setActiveCity(city.label);
    if (typeof window.__sentinelFlyTo === "function") {
      window.__sentinelFlyTo(city.lon, city.lat, 800_000);
    }
  }, []);

  return (
    <div className="flex flex-col h-screen bg-[#0a0e1a] text-slate-200 overflow-hidden">

      {/* ── TOP SECRET banner ── */}
      <div className="flex items-center justify-center py-0.5 bg-[#8b0000] border-b border-red-900">
        <Lock size={9} className="text-red-200 mr-1.5" />
        <span className="text-[10px] font-bold tracking-[0.3em] text-red-100">
          TOP SECRET // SI-TK // NOFORN
        </span>
      </div>

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-[#1a2744] bg-[#0d1424]">
        {/* Logo */}
        <div className="flex items-center gap-2 min-w-[180px]">
          <div className="w-5 h-5 border border-[#00d4ff]/60 flex items-center justify-center">
            <div className="w-2 h-2 bg-[#00d4ff]" />
          </div>
          <div>
            <div className="text-[#00d4ff] font-bold text-sm tracking-[0.2em]">SENTINEL</div>
            <div className="text-slate-600 text-[9px] tracking-widest">GLOBAL INTELLIGENCE PLATFORM</div>
          </div>
        </div>

        {/* Stat sayaçları */}
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 px-2 py-1 border border-[#1a2744] rounded">
            <span className="text-slate-500 text-[10px]">AIR</span>
            <span className="text-[#00d4ff] font-mono font-bold">{stats.aircraft.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 border border-[#1a2744] rounded">
            <span className="text-slate-500 text-[10px]">SEA</span>
            <span className="text-[#00ff88] font-mono font-bold">{stats.ships}</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 border border-[#1a2744] rounded">
            <span className="text-slate-500 text-[10px]">SAT</span>
            <span className="text-[#a78bfa] font-mono font-bold">{stats.satellites}</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 border border-[#1a2744] rounded">
            <span className="text-slate-500 text-[10px]">SEIS</span>
            <span className="text-[#ffaa00] font-mono font-bold">{stats.earthquakes}</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 border border-[#1a2744] rounded">
            <span className="text-slate-500 text-[10px]">CYBER</span>
            <span className="text-[#ff3366] font-mono font-bold">{stats.threats}</span>
          </div>
          {unreadAlerts > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 border border-[#ff3366]/40 rounded bg-[#ff3366]/10 animate-pulse">
              <span className="text-[#ff3366] text-[10px]">ALERT {unreadAlerts}</span>
            </div>
          )}
        </div>

        {/* Sağ aksiyonlar */}
        <div className="flex items-center gap-2 min-w-[280px] justify-end">
          <div className="flex flex-col items-end mr-1">
            <UtcClock />
            <span className="text-[9px] font-mono text-slate-500 tracking-wider">ORB: 47439 PASS: DESC-179</span>
          </div>
          <div className="flex items-center gap-1 px-2 py-1 border border-[#ff3366]/30 rounded">
            <div className="w-1.5 h-1.5 rounded-full bg-[#ff3366] animate-pulse" />
            <span className="text-[#ff3366] text-[10px] font-bold tracking-wider">REC</span>
          </div>
          <div className="flex border border-[#1a2744] rounded overflow-hidden">
            <button
              onClick={() => setIsLive(true)}
              className={`px-2 py-1 text-[10px] font-bold tracking-wider transition-colors ${
                isLive ? "bg-[#00d4ff]/20 text-[#00d4ff]" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              LIVE
            </button>
            <button
              onClick={() => setIsLive(false)}
              className={`px-2 py-1 text-[10px] font-bold tracking-wider transition-colors ${
                !isLive ? "bg-[#a78bfa]/20 text-[#a78bfa]" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              PLAYBACK
            </button>
          </div>
          <button
            onClick={() => setShowAISettings(true)}
            className="flex items-center gap-1 px-2 py-1 bg-[#00d4ff]/10 border border-[#00d4ff]/30 rounded text-[10px] text-[#00d4ff] hover:bg-[#00d4ff]/20 transition-all"
          >
            <Settings size={10} />AI
          </button>
          <button
            onClick={() => setShowGeoSeer(true)}
            className="flex items-center gap-1 px-2 py-1 bg-[#00ff88]/10 border border-[#00ff88]/30 rounded text-[10px] text-[#00ff88] hover:bg-[#00ff88]/20 transition-all"
          >
            <Image size={10} />GEOSEER
          </button>
          <button
            onClick={() => setShowRouteOps(true)}
            className="flex items-center gap-1 px-2 py-1 bg-[#a78bfa]/10 border border-[#a78bfa]/30 rounded text-[10px] text-[#a78bfa] hover:bg-[#a78bfa]/20 transition-all"
          >
            <Route size={10} />ROUTE OPS
          </button>
          <button
            onClick={() => setShowChat(!showChat)}
            className={`flex items-center gap-1 px-2 py-1 border rounded text-[10px] transition-all ${
              showChat
                ? "bg-[#7c3aed]/30 border-[#7c3aed]/60 text-[#a78bfa]"
                : "bg-[#7c3aed]/10 border-[#7c3aed]/30 text-[#a78bfa] hover:bg-[#7c3aed]/20"
            }`}
          >
            <Brain size={10} />ANALYST
          </button>
          <div
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] border ${
              wsStatus === "connected"
                ? "text-[#00ff88] border-[#00ff88]/20"
                : "text-[#ff3366] border-[#ff3366]/20"
            }`}
          >
            <div
              className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                wsStatus === "connected" ? "bg-[#00ff88]" : "bg-[#ff3366]"
              }`}
            />
            <Radio size={9} />
            {wsStatus === "connected" ? "ONLINE" : wsStatus.toUpperCase()}
          </div>
        </div>
      </div>

      {/* ── Ana içerik alanı ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Sol panel */}
        <div className="w-56 flex flex-col gap-1 p-1.5 border-r border-[#1a2744] overflow-y-auto bg-[#0a0e1a]">
          <StatsPanel />
          <OperationalPicturePanel />
          <PersonsPanel />
          <PersonsGraphPanel />
          <LayerControls />
          <ThemeControls />
        </div>

        {/* Globe + alt barlar */}
        <div className="flex-1 relative flex flex-col overflow-hidden">

          {/* Globe */}
          <div className="flex-1 relative overflow-hidden">
            <CesiumGlobePanel />
            {!isLive && (
              <PlaybackPanel onClose={() => setIsLive(true)} />
            )}
          </div>

          {/* ── LOCATIONS bar ── */}
          <div className="shrink-0 bg-[#0a0e1a]/95 border-t border-[#1a2744] px-3 py-1 flex items-center gap-1 overflow-x-auto">
            <span className="text-[9px] text-slate-600 tracking-widest shrink-0 mr-1">LOCATIONS</span>
            {CITY_LOCATIONS.map((city) => {
              const isActive = activeCity === city.label;
              return (
                <button
                  key={city.label}
                  onClick={() => handleCityClick(city)}
                  className="shrink-0 px-2 py-0.5 rounded text-[10px] font-mono tracking-wide border transition-all"
                  style={
                    isActive
                      ? { color: "#00d4ff", borderColor: "#00d4ff", background: "#00d4ff22" }
                      : { color: "#475569", borderColor: "#1a2744", background: "transparent" }
                  }
                >
                  {city.label}
                </button>
              );
            })}
          </div>

          {/* ── STYLE PRESETS bar ── */}
          <div className="shrink-0 bg-[#0a0e1a]/95 border-t border-[#1a2744] px-3 py-1.5 flex items-center justify-center gap-2">
            <span className="text-[9px] text-slate-600 tracking-widest shrink-0 mr-1">STYLE PRESETS</span>
            {STYLE_PRESETS.map((s) => {
              const isActive = mapTheme === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => setMapTheme(s.key)}
                  className="flex flex-col items-center px-2 py-1 rounded border transition-all"
                  style={
                    isActive
                      ? { color: s.color, borderColor: s.color, background: s.color + "22" }
                      : { color: "#334155", borderColor: "#1a2744", background: "transparent" }
                  }
                >
                  <span className="text-[13px] leading-none">{s.icon}</span>
                  <span className="text-[9px] mt-0.5 font-bold tracking-wide">{s.label}</span>
                </button>
              );
            })}
          </div>

          {/* ── NEWS FEED dock (Edge-style) ── */}
          <NewsDock />
        </div>

        {/* Sağ panel */}
        <div className="w-72 flex flex-col border-l border-[#1a2744] overflow-hidden bg-[#0a0e1a]">
          <DataIntegrityPanel />
          <div className="flex-1 overflow-hidden border-t border-[#1a2744]">
            <AlertPanel />
          </div>
        </div>
      </div>

      {/* ── BOTTOM SECRET banner ── */}
      <div className="flex items-center justify-center py-0.5 bg-[#8b0000] border-t border-red-900">
        <span className="text-[10px] font-bold tracking-[0.3em] text-red-100">
          TOP SECRET // SI-TK // NOFORN
        </span>
      </div>

      {/* ── Float paneller ── */}
      {showChat && (
        <div className="absolute bottom-8 right-[300px] w-96 z-50">
          <AIChat sendQuery={sendQuery} onClose={() => setShowChat(false)} />
        </div>
      )}
      {showAISettings && <AIProviderPanel onClose={() => setShowAISettings(false)} />}
      {showGeoSeer    && <GeoSeerPanel    onClose={() => setShowGeoSeer(false)} />}
      {showRouteOps   && <RouteOpsPanel   onClose={() => setShowRouteOps(false)} />}
    </div>
  );
}