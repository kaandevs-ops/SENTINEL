import { useState } from "react";
import { useSentinelStore } from "../../store/useSentinelStore";
import { Check, X } from "lucide-react";

const THREAT_STYLE = {
  critical: "text-[#ff3366] border-[#ff3366]/30 bg-[#ff3366]/5",
  high:     "text-[#ff6633] border-[#ff6633]/30 bg-[#ff6633]/5",
  medium:   "text-[#ffaa00] border-[#ffaa00]/30 bg-[#ffaa00]/5",
  low:      "text-[#00ff88] border-[#00ff88]/30 bg-[#00ff88]/5",
};

function extractPersonId(alert) {
  const text = `${alert?.title || ""} ${alert?.description || ""}`;
  const match = text.match(/\bPRS-\d{3,6}\b/i);
  return match ? match[0].toUpperCase() : null;
}

function AlertItem({ alert, onRead, onResolve, onFocusPerson }) {
  const personId = extractPersonId(alert);
  return (
    <div className={`text-xs p-2 rounded border ${THREAT_STYLE[alert.threat_level] || THREAT_STYLE.low} mb-1`}>
      <div className="flex items-start justify-between gap-1">
        <div className="font-bold flex-1 leading-tight">{alert.title}</div>
        <div className="flex gap-1 shrink-0">
          {!alert.is_read && (
            <button onClick={() => onRead(alert.id)} title="Mark read" className="opacity-50 hover:opacity-100"><Check size={10} /></button>
          )}
          <button onClick={() => onResolve(alert.id)} title="Resolve" className="opacity-50 hover:opacity-100"><X size={10} /></button>
        </div>
      </div>
      <div className="text-slate-500 mt-0.5 line-clamp-2">{alert.description}</div>
      {personId && (
        <button
          onClick={() => onFocusPerson(personId)}
          className="mt-1 text-[10px] px-1.5 py-0.5 border border-[#22d3ee]/40 rounded text-[#22d3ee] hover:bg-[#22d3ee]/10"
        >
          Focus {personId}
        </button>
      )}
    </div>
  );
}

export default function AlertPanel() {
  const { alerts, earthquakes, threats, news, wildfires, cameras, conflicts, cyberIocs, persons } = useSentinelStore();
  const [tab, setTab] = useState("alerts");
  const recentEq = earthquakes.filter((e) => (e.magnitude || 0) >= 3).slice(0, 8);
  const setSelectedPersonId = useSentinelStore((s) => s.setSelectedPersonId);

  const handleRead = async (id) => {
    await fetch(`/api/alerts/${id}/read`, { method: "POST" });
    useSentinelStore.setState((s) => ({ alerts: s.alerts.map((a) => a.id === id ? { ...a, is_read: true } : a) }));
  };

  const handleResolve = async (id) => {
    await fetch(`/api/alerts/${id}/resolve`, { method: "POST" });
    useSentinelStore.setState((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) }));
  };

  const handleFocusPerson = (personId) => {
    setSelectedPersonId(personId);
    const p = persons.find((x) => x.id === personId);
    if (p && typeof window.__sentinelFlyTo === "function") {
      window.__sentinelFlyTo(Number(p.longitude || 0), Number(p.latitude || 0), 500000);
    }
  };

  const tabs = [
    { key: "alerts",  label: `Alerts(${alerts.length})` },
    { key: "seismic", label: `Seismic(${earthquakes.length})` },
    { key: "threats", label: `Cyber(${threats.length})` },
    { key: "news",    label: `News(${news.length})` },
    { key: "fires",   label: `Fires(${wildfires.length})` },
    { key: "cams",    label: `Cams(${cameras.length})` },
    { key: "conflicts", label: `Conflicts(${conflicts.length})` },
    { key: "iocs", label: `IOCs(${cyberIocs.length})` },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-[#1a2744] shrink-0">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-1.5 text-[10px] font-medium transition-colors ${tab === t.key ? "text-[#00d4ff] border-b border-[#00d4ff]" : "text-slate-500 hover:text-slate-300"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {tab === "alerts" && (
          <>
            {alerts.length === 0 && <div className="text-slate-600 text-xs p-2">No active alerts</div>}
            {alerts.map((a) => <AlertItem key={a.id} alert={a} onRead={handleRead} onResolve={handleResolve} onFocusPerson={handleFocusPerson} />)}
          </>
        )}
        {tab === "seismic" && (
          <div className="space-y-1">
            {recentEq.length === 0 && <div className="text-slate-600 text-xs p-2">No recent earthquakes</div>}
            {recentEq.map((eq) => (
              <div key={eq.id} className="flex items-start justify-between text-xs py-1 border-b border-[#1a2744]">
                <div className="flex-1">
                  <div className="text-slate-300">{eq.place}</div>
                  <div className="text-slate-600">{(eq.time || "").slice(0, 16).replace("T", " ")}</div>
                </div>
                <span className={`font-mono font-bold ml-2 ${eq.magnitude >= 6 ? "text-[#ff3366]" : eq.magnitude >= 4 ? "text-[#ffaa00]" : "text-slate-400"}`}>
                  M{(eq.magnitude || 0).toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        )}
        {tab === "threats" && (
          <div className="space-y-1">
            {threats.slice(0, 20).map((t) => (
              <div key={t.id} className="text-xs py-1 border-b border-[#1a2744]">
                <div className="flex justify-between">
                  <span className="text-slate-400 font-mono">{t.ip}</span>
                  <span className="text-[#ff3366]">{t.malware}</span>
                </div>
                <div className="text-slate-600">{t.country} - {(t.as_name || "").slice(0, 30)}</div>
              </div>
            ))}
          </div>
        )}
        {tab === "news" && (
          <div className="space-y-2">
            {news.length === 0 && <div className="text-slate-600 text-xs p-2">No recent news</div>}
            {news.slice(0, 15).map((n, i) => (
              <div key={i} className="text-xs py-1 border-b border-[#1a2744]">
                <a href={n.url} target="_blank" rel="noreferrer" className="text-slate-300 hover:text-[#00d4ff] line-clamp-2">{n.title}</a>
                <div className="text-slate-600 mt-0.5">{n.source} - {n.country}</div>
              </div>
            ))}
          </div>
        )}
        {tab === "fires" && (
          <div className="space-y-2">
            {wildfires.length === 0 && <div className="text-slate-600 text-xs p-2">No active wildfire events</div>}
            {wildfires.slice(0, 20).map((w) => (
              <button
                key={w.id}
                onClick={() => {
                  if (typeof window.__sentinelFlyTo === "function" && w?.longitude != null && w?.latitude != null) {
                    window.__sentinelFlyTo(Number(w.longitude), Number(w.latitude), 1_400_000);
                  }
                }}
                className="w-full text-left text-xs py-1 border-b border-[#1a2744] hover:bg-[#1a2744]/30 px-1 rounded"
              >
                <div className="text-slate-300 line-clamp-2">🔥 {w.title}</div>
                <div className="text-slate-600 mt-0.5 font-mono">
                  {String(w.reported_at || w.updated || "").slice(0, 19).replace("T", " ")} · {w.geo_precision || "—"}
                </div>
              </button>
            ))}
          </div>
        )}
        {tab === "cams" && (
          <div className="space-y-2">
            {cameras.length === 0 && <div className="text-slate-600 text-xs p-2">No camera points loaded</div>}
            {cameras.slice(0, 25).map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  if (typeof window.__sentinelFlyTo === "function" && c?.longitude != null && c?.latitude != null) {
                    window.__sentinelFlyTo(Number(c.longitude), Number(c.latitude), 600_000);
                  }
                }}
                className="w-full text-left text-xs py-1 border-b border-[#1a2744] hover:bg-[#1a2744]/30 px-1 rounded"
              >
                <div className="text-slate-300 line-clamp-1">📷 {c.name || "Camera"} <span className="text-slate-600">· {c.provider || c.source || "osint"}</span></div>
                <div className="text-slate-600 mt-0.5 font-mono line-clamp-1">
                  {c.stream_url ? "stream" : "no-stream"}{c.osm_url ? " · osm" : ""}{c.status ? ` · ${c.status}` : ""}
                </div>
              </button>
            ))}
          </div>
        )}
        {tab === "conflicts" && (
          <div className="space-y-2">
            {conflicts.length === 0 && <div className="text-slate-600 text-xs p-2">No conflict events loaded</div>}
            {conflicts.slice(0, 25).map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  if (typeof window.__sentinelFlyTo === "function" && c?.longitude != null && c?.latitude != null) {
                    window.__sentinelFlyTo(Number(c.longitude), Number(c.latitude), 1_200_000);
                  }
                }}
                className="w-full text-left text-xs py-1 border-b border-[#1a2744] hover:bg-[#1a2744]/30 px-1 rounded"
              >
                <div className="text-slate-300 line-clamp-2">⚠ {c.title}</div>
                <div className="text-slate-600 mt-0.5 font-mono line-clamp-1">
                  {c.country || "-"} · mentions {c.mention_count ?? 0}
                </div>
              </button>
            ))}
          </div>
        )}
        {tab === "iocs" && (
          <div className="space-y-2">
            {cyberIocs.length === 0 && <div className="text-slate-600 text-xs p-2">No IOC rows loaded</div>}
            {cyberIocs.slice(0, 30).map((ioc) => (
              <a
                key={ioc.id}
                href={ioc.url || "#"}
                target="_blank"
                rel="noreferrer"
                className="block text-left text-xs py-1 border-b border-[#1a2744] hover:bg-[#1a2744]/30 px-1 rounded"
              >
                <div className="text-slate-300 line-clamp-1">🧪 {ioc.host || "ioc-host"} <span className="text-slate-600">· {ioc.payload || "-"}</span></div>
                <div className="text-slate-600 mt-0.5 font-mono line-clamp-1">
                  {ioc.tags || "-"} · {String(ioc.date_added || "").slice(0, 19)}
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
