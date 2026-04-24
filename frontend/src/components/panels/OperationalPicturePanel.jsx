import { useEffect, useMemo, useState } from "react";
import { useSentinelStore } from "../../store/useSentinelStore";
import { fetchJson, unwrapData } from "../../lib/apiClient";

const LEVEL_CLASS = {
  low: "text-[#00ff88]",
  medium: "text-[#ffaa00]",
  high: "text-[#ff6633]",
  critical: "text-[#ff3366]",
};

export default function OperationalPicturePanel() {
  const [data, setData] = useState(null);
  const feedTimeline = useSentinelStore((s) => s.feedTimeline || []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const payload = await fetchJson("/api/intelligence/overview");
        if (alive) setData(unwrapData(payload, null));
      } catch {
        // no-op
      }
    };
    load();
    const id = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const level = data?.threat_level || "low";
  const hotspots = data?.hotspots || [];
  const personOps = useMemo(
    () => feedTimeline.filter((e) => e.feed === "persons").slice(0, 3),
    [feedTimeline]
  );

  return (
    <div className="sentinel-panel p-2 space-y-1">
      <div className="text-[#00d4ff] text-[10px] font-bold tracking-widest px-1">OPERATIONAL PICTURE</div>
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-slate-500 text-[10px] tracking-wider">GLOBAL LEVEL</span>
        <span className={`text-[11px] font-bold tracking-widest ${LEVEL_CLASS[level] || "text-slate-400"}`}>
          {level.toUpperCase()}
        </span>
      </div>

      {hotspots.slice(0, 3).map((h) => (
        <div key={h.region} className="px-2 py-1 border-t border-[#1a2744] text-[10px]">
          <div className="flex items-center justify-between">
            <span className="text-slate-300 truncate mr-2">{h.region}</span>
            <span className={`font-mono ${LEVEL_CLASS[h.threat_level] || "text-slate-400"}`}>{h.score}</span>
          </div>
          <div className="text-slate-600 mt-0.5">
            EQ:{h.signals?.earthquakes || 0} WX:{h.signals?.weather || 0} TH:{h.signals?.threats || 0}
          </div>
        </div>
      ))}

      {data?.recommendation && (
        <div className="px-2 pt-1 border-t border-[#1a2744] text-[10px] text-slate-400 leading-relaxed">
          {data.recommendation}
        </div>
      )}

      <div className="px-2 pt-1 border-t border-[#1a2744]">
        <div className="text-[9px] text-slate-600 tracking-widest mb-1">PERSON OPS</div>
        {personOps.map((e) => (
          <div key={e.id} className="text-[10px] text-slate-400 flex items-center justify-between">
            <span className="truncate mr-2">
              {(e.status || "unknown").toUpperCase()} · {(e.payload?.person_id || "N/A")}
            </span>
            <span className={`${LEVEL_CLASS[e.severity] || "text-slate-500"}`}>
              {(e.severity || "info").toUpperCase()}
            </span>
          </div>
        ))}
        {personOps.length === 0 && (
          <div className="text-[10px] text-slate-600">No person operations yet.</div>
        )}
      </div>
    </div>
  );
}
