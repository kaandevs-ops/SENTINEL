import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, useMapEvents } from "react-leaflet";
import { Loader, Route, X, RotateCcw, ArrowLeftRight } from "lucide-react";
import "leaflet/dist/leaflet.css";
import { useSentinelStore } from "../../store/useSentinelStore";

function PickPoints({ onPick }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function levelClass(level) {
  if (level === "critical") return "text-[#ff3366]";
  if (level === "high") return "text-[#ff6633]";
  if (level === "medium") return "text-[#ffaa00]";
  return "text-[#00ff88]";
}

function markerColor(kind) {
  if (kind === "earthquake") return "#ff6633";
  if (kind === "weather") return "#ffaa00";
  if (kind === "gps_jamming") return "#ff3366";
  if (kind === "cyber_threat") return "#a78bfa";
  return "#38bdf8";
}

export default function RouteOpsPanel({ onClose }) {
  const { setRouteOpsOverlay } = useSentinelStore();
  const mapTheme = useSentinelStore((s) => s.mapTheme);
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);
  const [corridorKm, setCorridorKm] = useState(180);
  const [selectedRouteId, setSelectedRouteId] = useState("A");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const selectedRoute = useMemo(() => {
    const routes = result?.routes || [];
    return routes.find((r) => r.id === selectedRouteId) || routes[0] || null;
  }, [result, selectedRouteId]);
  const routePolyline = useMemo(() => (selectedRoute?.route || []).map((p) => [p.lat, p.lon]), [selectedRoute]);
  const incidents = selectedRoute?.incidents || [];
  const summary = result?.summary || selectedRoute?.metrics;
  const segmentHeat = selectedRoute?.segments || [];

  useEffect(() => {
    if (!result || !selectedRoute) return;
    setRouteOpsOverlay({ ...result, selected_route_id: selectedRoute.id });
  }, [result, selectedRoute, setRouteOpsOverlay]);

  const handlePick = (lat, lon) => {
    if (!start) {
      setStart({ lat, lon });
      return;
    }
    if (!end) {
      setEnd({ lat, lon });
      return;
    }
    setStart({ lat, lon });
    setEnd(null);
    setResult(null);
    setRouteOpsOverlay(null);
  };

  const segmentColor = (risk) => {
    if (risk >= 75) return "#ff3366";
    if (risk >= 55) return "#ff6633";
    if (risk >= 30) return "#ffaa00";
    return "#00ff88";
  };

  const reset = () => {
    setStart(null);
    setEnd(null);
    setResult(null);
    setSelectedRouteId("A");
    setError("");
    setRouteOpsOverlay(null);
  };

  const swap = () => {
    if (!start || !end) return;
    const s = start;
    setStart(end);
    setEnd(s);
    setResult(null);
    setRouteOpsOverlay(null);
  };

  const accent =
    mapTheme === "nvg" ? "#39ff14" :
    mapTheme === "flir" ? "#ff6600" :
    mapTheme === "crt" ? "#00ff88" :
    mapTheme === "noir" ? "#ffffff" :
    "#00d4ff";

  const tileUrl =
    mapTheme === "noir"
      ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

  const analyze = async () => {
    if (!start || !end || loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/routeops/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_lat: start.lat,
          start_lon: start.lon,
          end_lat: end.lat,
          end_lon: end.lon,
          corridor_km: corridorKm,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload?.detail || "Route analysis failed.");
      } else {
        setResult(payload.data);
        setSelectedRouteId(payload.data?.recommended_route_id || "A");
      }
    } catch {
      setError("Backend bağlantısı kurulamadı.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-[#0d1424] border border-[#1a2744] rounded-xl w-[min(1200px,calc(100vw-20px))] max-h-[92vh] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[#1a2744]">
          <div className="flex items-center gap-3">
            <div className="font-bold text-sm tracking-wider" style={{ color: accent }}>
              ROUTE OPS // CORRIDOR INTELLIGENCE
            </div>
            <div className="hidden md:flex items-center gap-2 text-[10px] font-mono text-slate-500">
              <span className="px-2 py-1 rounded border border-[#1a2744] bg-[#0a0e1a]/70">
                Corridor {corridorKm} km
              </span>
              {summary?.risk_score != null && (
                <span className="px-2 py-1 rounded border border-[#1a2744] bg-[#0a0e1a]/70">
                  Risk {summary.risk_score}/100
                </span>
              )}
              {selectedRoute?.metrics?.eta_with_delay_min != null && (
                <span className="px-2 py-1 rounded border border-[#1a2744] bg-[#0a0e1a]/70">
                  ETA {selectedRoute.metrics.eta_with_delay_min}m
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={16} /></button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-3 p-3 h-[calc(92vh-78px)]">
          <div className="border border-[#1a2744] rounded overflow-hidden h-[42vh] lg:h-full min-h-[300px]">
            <MapContainer center={[30, 20]} zoom={3} style={{ width: "100%", height: "100%" }}>
              <TileLayer
                url={tileUrl}
                attribution='&copy; <a href="https://carto.com">CARTO</a>'
              />
              <PickPoints onPick={handlePick} />
              {start && (
                <CircleMarker center={[start.lat, start.lon]} radius={8} pathOptions={{ color: "#00ff88", fillColor: "#00ff88", fillOpacity: 0.7 }}>
                  <Popup>START</Popup>
                </CircleMarker>
              )}
              {end && (
                <CircleMarker center={[end.lat, end.lon]} radius={8} pathOptions={{ color: "#00d4ff", fillColor: "#00d4ff", fillOpacity: 0.7 }}>
                  <Popup>END</Popup>
                </CircleMarker>
              )}
              {routePolyline.length > 1 && (
                <>
                  {routePolyline.slice(1).map((pt, i) => {
                    const prev = routePolyline[i];
                    const segRisk = segmentHeat.find((s) => s.index === i)?.risk || 0;
                    return (
                      <Polyline
                        key={`seg-${i}`}
                        positions={[prev, pt]}
                        pathOptions={{ color: segmentColor(segRisk), weight: 5, opacity: 0.9 }}
                      />
                    );
                  })}
                </>
              )}
              {incidents.slice(0, 120).map((inc, i) => (
                <CircleMarker
                  key={`${inc.kind}-${i}`}
                  center={[inc.lat, inc.lon]}
                  radius={Math.max(4, Math.min(9, Math.round(inc.impact)))}
                  pathOptions={{ color: markerColor(inc.kind), fillColor: markerColor(inc.kind), fillOpacity: 0.45, weight: 1.5 }}
                >
                  <Popup>
                    {inc.title}
                    <br />
                    {inc.kind} | {inc.distance_km} km
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>

          <div className="space-y-2 overflow-y-auto pr-1 min-h-0">
            <div className="p-2 border border-[#1a2744] rounded text-xs">
              <div className="flex items-center justify-between">
                <div className="text-slate-500 mb-1">Point Selection</div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={swap}
                    disabled={!start || !end}
                    className="px-2 py-1 rounded border border-[#1a2744] text-slate-400 hover:text-slate-200 hover:bg-[#1a2744]/30 disabled:opacity-40"
                    title="Swap start/end"
                  >
                    <ArrowLeftRight size={12} />
                  </button>
                  <button
                    onClick={reset}
                    className="px-2 py-1 rounded border border-[#1a2744] text-slate-400 hover:text-slate-200 hover:bg-[#1a2744]/30"
                    title="Reset"
                  >
                    <RotateCcw size={12} />
                  </button>
                </div>
              </div>
              <div className="text-slate-300">Haritada önce START sonra END noktası seç.</div>
              <div className="mt-1 text-slate-500">Start: {start ? `${start.lat.toFixed(3)}, ${start.lon.toFixed(3)}` : "-"}</div>
              <div className="text-slate-500">End: {end ? `${end.lat.toFixed(3)}, ${end.lon.toFixed(3)}` : "-"}</div>
              <div className="mt-2">
                <label className="text-slate-500">Corridor (km): {corridorKm}</label>
                <input
                  type="range"
                  min={20}
                  max={1000}
                  step={10}
                  value={corridorKm}
                  onChange={(e) => setCorridorKm(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <button
                onClick={analyze}
                disabled={!start || !end || loading}
                className="w-full mt-2 py-2 text-xs bg-[#00d4ff]/10 border border-[#00d4ff] text-[#00d4ff] rounded hover:bg-[#00d4ff]/20 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {loading ? <Loader size={12} className="animate-spin" /> : <Route size={12} />}
                Analyze Corridor
              </button>
              {result?.routes?.length > 0 && (
                <button
                  onClick={() => setRouteOpsOverlay({ ...result, selected_route_id: selectedRoute?.id || result.recommended_route_id })}
                  className="w-full mt-2 py-2 text-xs bg-[#00ff88]/10 border border-[#00ff88]/30 text-[#00ff88] rounded hover:bg-[#00ff88]/20"
                >
                  Push To Cesium Layer
                </button>
              )}
              {error && <div className="mt-2 text-[#ff3366]">{error}</div>}
            </div>

            {/* Legend */}
            <div className="p-2 border border-[#1a2744] rounded text-xs">
              <div className="text-slate-500 mb-1">Segment Risk Legend</div>
              <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                <span className="flex items-center gap-1 text-slate-500"><span className="w-2 h-2 rounded-sm" style={{ background: "#00ff88" }} />0-29</span>
                <span className="flex items-center gap-1 text-slate-500"><span className="w-2 h-2 rounded-sm" style={{ background: "#ffaa00" }} />30-54</span>
                <span className="flex items-center gap-1 text-slate-500"><span className="w-2 h-2 rounded-sm" style={{ background: "#ff6633" }} />55-74</span>
                <span className="flex items-center gap-1 text-slate-500"><span className="w-2 h-2 rounded-sm" style={{ background: "#ff3366" }} />75+</span>
              </div>
              {segmentHeat.length > 0 && (
                <div className="mt-2 h-8 border border-[#1a2744] rounded bg-[#0a0e1a]/60 overflow-hidden flex">
                  {segmentHeat.slice(0, 120).map((s) => (
                    <div
                      key={s.index}
                      className="h-full"
                      style={{
                        width: `${100 / Math.min(120, segmentHeat.length)}%`,
                        background: segmentColor(s.risk || 0),
                        opacity: 0.55,
                      }}
                      title={`seg ${s.index}: ${s.risk}`}
                    />
                  ))}
                </div>
              )}
            </div>

            {result?.routes?.length > 0 && (
              <div className="p-2 border border-[#1a2744] rounded text-xs">
                <div className="text-slate-500 mb-1">Alternative Routes (A/B/C)</div>
                <div className="space-y-1">
                  {result.routes.map((r) => {
                    const m = r.metrics || {};
                    const isRec = r.id === result.recommended_route_id;
                    return (
                      <button
                        key={r.id}
                        onClick={() => setSelectedRouteId(r.id)}
                        className={`w-full text-left px-2 py-1 rounded border ${selectedRoute?.id === r.id ? "border-[#00d4ff]/40 bg-[#00d4ff]/10" : "border-[#1a2744] hover:bg-[#1a2744]/40"}`}
                      >
                        <div className="text-slate-200">
                          {r.id} - {r.name} {isRec ? <span className="text-[#00ff88]">(Recommended)</span> : null}
                        </div>
                        <div className="text-slate-500">
                          ETA {m.eta_with_delay_min} dk | Delay {m.delay_min} dk | Risk {m.risk_score}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {summary && (
              <div className="p-2 border border-[#1a2744] rounded text-xs">
                <div className="text-slate-500">Risk Score</div>
                <div className={`text-sm font-bold mt-1 ${levelClass(summary.risk_level)}`}>{summary.risk_score} / 100 ({summary.risk_level?.toUpperCase?.() || "-"})</div>
                <div className="text-slate-500 mt-1">Incidents: {summary.incident_count || incidents.length}</div>
                {selectedRoute?.metrics && (
                  <div className="text-slate-500 mt-1">
                    Distance: {selectedRoute.metrics.distance_km} km | ETA: {selectedRoute.metrics.eta_with_delay_min} dk
                  </div>
                )}
                <div className="text-slate-400 mt-2 leading-relaxed">{result?.summary?.recommendation || "-"}</div>
              </div>
            )}

            <div className="p-2 border border-[#1a2744] rounded text-xs h-[330px] overflow-y-auto">
              <div className="text-slate-500 mb-1">Route Incidents</div>
              {incidents.length === 0 && <div className="text-slate-600">No incidents in corridor.</div>}
              {incidents.slice(0, 60).map((inc, i) => (
                <div key={`${inc.kind}-${i}`} className="py-1 border-b border-[#1a2744]/60">
                  <div className="text-slate-200">{inc.title}</div>
                  <div className="text-slate-500">
                    {inc.kind} | {inc.severity} | {inc.distance_km}km | impact {inc.impact}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
