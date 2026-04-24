import { useState, useEffect } from "react";
import { useSentinelStore } from "../../store/useSentinelStore";
import { fetchJson, unwrapData } from "../../lib/apiClient";

const LEVEL_COLOR = { low: "text-[#00ff88]", medium: "text-[#ffaa00]", high: "text-[#ff6633]", critical: "text-[#ff3366]" };
const LEVEL_BG = { low: "bg-[#00ff88]/10 border-[#00ff88]/30", medium: "bg-[#ffaa00]/10 border-[#ffaa00]/30", high: "bg-[#ff6633]/10 border-[#ff6633]/30", critical: "bg-[#ff3366]/10 border-[#ff3366]/30 animate-pulse" };

export default function StatsPanel() {
  const { earthquakes, weatherAlerts, aircraft } = useSentinelStore();
  const [situation, setSituation] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const payload = await fetchJson("/api/intelligence/situation");
        setSituation(unwrapData(payload, null));
      } catch {
        return;
      }
    };
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  const maxMag = earthquakes.length ? Math.max(...earthquakes.map(e => e.magnitude || 0)).toFixed(1) : null;
  const level = situation?.threat_level || null;

  const topCountries = (() => {
    if (!aircraft.length) return [];
    const counts = {};
    for (const a of aircraft) { const c = a.country || "Unknown"; counts[c] = (counts[c] || 0) + 1; }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([country, count]) => ({ country, count }));
  })();

  return (
    <div className="sentinel-panel p-2 space-y-1">
      <div className="text-[#00d4ff] text-[10px] font-bold tracking-widest px-1">SITUATION</div>
      {level && (
        <div className={`flex items-center justify-between px-2 py-1.5 rounded border text-xs ${LEVEL_BG[level] || "bg-slate-800/50 border-slate-700"}`}>
          <span className="text-slate-400 text-[10px] tracking-wider">THREAT LEVEL</span>
          <span className={`font-bold tracking-widest text-[11px] ${LEVEL_COLOR[level] || "text-slate-400"}`}>
            {level.toUpperCase()}
          </span>
        </div>
      )}
      {maxMag && (
        <div className="flex items-center justify-between px-2 py-1 text-[11px]">
          <span className="text-slate-500">MAX SEISMIC</span>
          <span className="text-[#ffaa00] font-mono font-bold">M{maxMag}</span>
        </div>
      )}
      {weatherAlerts.length > 0 && (
        <div className="flex items-center justify-between px-2 py-1 text-[11px]">
          <span className="text-slate-500">WX ALERTS</span>
          <span className="text-[#f59e0b] font-mono font-bold">{weatherAlerts.length}</span>
        </div>
      )}
      {topCountries.length > 0 && (
        <div className="px-2 pt-1 border-t border-[#1a2744]">
          <div className="text-[9px] text-slate-600 tracking-widest mb-1">TOP AIR COUNTRIES</div>
          {topCountries.map(({ country, count }) => (
            <div key={country} className="flex items-center justify-between text-[10px] py-0.5">
              <span className="text-slate-400 truncate">{country}</span>
              <span className="text-[#00d4ff] font-mono ml-2">{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
