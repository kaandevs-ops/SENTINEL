import { useMemo, useState } from "react";
import { useSentinelStore } from "../../store/useSentinelStore";

const FEEDS = [
  { key: "aircraft", label: "AIR", color: "#00d4ff" },
  { key: "ships", label: "SEA", color: "#00ff88" },
  { key: "satellites", label: "SAT", color: "#a78bfa" },
  { key: "persons", label: "HUM", color: "#22d3ee" },
  { key: "earthquakes", label: "SEIS", color: "#ffaa00" },
  { key: "weather", label: "WX", color: "#f59e0b" },
  { key: "news", label: "NEWS", color: "#38bdf8" },
  { key: "threats", label: "THREAT", color: "#ff3366" },
];

function statusClass(status) {
  if (status === "healthy") return "text-[#00ff88]";
  if (status === "degraded") return "text-[#ffaa00]";
  if (status === "stale") return "text-[#ff3366]";
  return "text-slate-500";
}

function statusText(status) {
  if (status === "healthy") return "OK";
  if (status === "degraded") return "LIMITED";
  if (status === "stale") return "STALE";
  return "UNKNOWN";
}

function severityClass(sev) {
  if (sev === "high") return "text-[#ff3366]";
  if (sev === "medium") return "text-[#ffaa00]";
  return "text-slate-500";
}

export default function DataIntegrityPanel() {
  const { feedHealth, feedTimeline } = useSentinelStore();
  const [feedFilter, setFeedFilter] = useState("all");
  const [sevFilter, setSevFilter] = useState("all");
  const filteredTimeline = useMemo(() => {
    return (feedTimeline || []).filter((e) => {
      if (feedFilter !== "all" && e.feed !== feedFilter) return false;
      if (sevFilter !== "all" && (e.severity || "info") !== sevFilter) return false;
      return true;
    });
  }, [feedFilter, sevFilter, feedTimeline]);

  return (
    <div className="sentinel-panel p-3">
      <div className="text-[#00d4ff] text-xs font-bold tracking-wider mb-2">◈ DATA INTEGRITY</div>
      <div className="space-y-1.5">
        {FEEDS.map((f) => {
          const h = feedHealth?.[f.key] || {};
          const lastFetch = h.lastFetch ? new Date(h.lastFetch).toLocaleTimeString() : "—";
          const confidence = typeof h.confidence === "number" ? `${h.confidence}%` : "—";
          return (
            <div key={f.key} className="flex items-center justify-between text-xs border-b border-[#1a2744]/60 pb-1">
              <div className="flex items-center gap-1.5">
                <span style={{ color: f.color }} className="font-semibold">{f.label}</span>
                <span className="text-slate-500">{lastFetch}</span>
                <span className="text-slate-600">{confidence}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-600">{h.source || "n/a"}</span>
                <span className={`font-semibold ${statusClass(h.status)}`}>{statusText(h.status)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 pt-2 border-t border-[#1a2744]">
        <div className="flex items-center justify-between mb-1">
          <div className="text-slate-400 text-[10px] tracking-widest">OPERATIONAL TIMELINE</div>
          <div className="flex items-center gap-1">
            <select
              value={feedFilter}
              onChange={(e) => setFeedFilter(e.target.value)}
              className="bg-[#0a0e1a] border border-[#1a2744] rounded text-[10px] text-slate-400 px-1 py-0.5"
            >
              <option value="all">ALL FEEDS</option>
              {FEEDS.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
            <select
              value={sevFilter}
              onChange={(e) => setSevFilter(e.target.value)}
              className="bg-[#0a0e1a] border border-[#1a2744] rounded text-[10px] text-slate-400 px-1 py-0.5"
            >
              <option value="all">ALL SEV</option>
              <option value="high">HIGH</option>
              <option value="medium">MEDIUM</option>
              <option value="info">INFO</option>
            </select>
          </div>
        </div>
        <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
          {filteredTimeline.slice(0, 8).map((e) => (
            <div key={e.id} className="text-[10px] text-slate-400 flex items-center justify-between">
              <span className="truncate mr-2">
                <span className={severityClass(e.severity || "info")}>
                  [{(e.severity || "info").toUpperCase()}]
                </span>{" "}
                {e.feed.toUpperCase()} {(e.prevStatus || e.prev_status || "unknown").toUpperCase()}→{(e.status || "unknown").toUpperCase()}
                {e.source ? ` · ${e.source}` : ""}
                {typeof e.confidence === "number" ? ` · ${e.confidence}%` : ""}
              </span>
              <span className="text-slate-500">{new Date(e.ts).toLocaleTimeString()}</span>
            </div>
          ))}
          {(filteredTimeline.length === 0) && (
            <div className="text-[10px] text-slate-600">No state transitions yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

