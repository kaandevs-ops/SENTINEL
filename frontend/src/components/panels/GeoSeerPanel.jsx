import { useEffect, useMemo, useState } from "react";
import { Loader, Upload, X } from "lucide-react";
import { MapContainer, TileLayer, CircleMarker, Popup, Circle } from "react-leaflet";
import "leaflet/dist/leaflet.css";

function levelColor(confidence) {
  if (confidence >= 80) return "text-[#00ff88]";
  if (confidence >= 60) return "text-[#ffaa00]";
  if (confidence >= 40) return "text-[#ff6633]";
  return "text-[#ff3366]";
}

export default function GeoSeerPanel({ onClose }) {
  const [files, setFiles] = useState([]);
  const [mode, setMode] = useState("fast");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [history, setHistory] = useState([]);

  const previews = useMemo(() => files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })), [files]);
  const mapCenter = useMemo(() => {
    const lat = selectedCandidate?.lat ?? result?.primary_location_guess?.lat;
    const lon = selectedCandidate?.lon ?? result?.primary_location_guess?.lon;
    if (typeof lat === "number" && typeof lon === "number") return [lat, lon];
    return [20, 0];
  }, [result, selectedCandidate]);

  useEffect(() => {
    return () => {
      for (const p of previews) URL.revokeObjectURL(p.url);
    };
  }, [previews]);

  const runAnalysis = async () => {
    if (!files.length || loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    setSelectedCandidate(null);
    try {
      const form = new FormData();
      form.append("mode", mode);
      files.forEach((f) => form.append("files", f));
      const res = await fetch("/api/geoseer/analyze", { method: "POST", body: form });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload?.detail || "GeoSeer analizi başarısız.");
      } else {
        setResult(payload.data);
        const top = payload.data?.candidates?.[0] || null;
        setSelectedCandidate(top);
        setHistory((prev) => [
          {
            id: `${Date.now()}`,
            ts: new Date().toISOString(),
            mode,
            imageCount: files.length,
            topName: top?.name || payload.data?.primary_location_guess?.name || "Unknown",
            confidence: payload.data?.confidence || 0,
            snapshot: payload.data,
          },
          ...prev,
        ].slice(0, 8));
      }
    } catch {
      setError("Backend bağlantısı kurulamadı.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-[#0d1424] border border-[#1a2744] rounded-xl w-[920px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-[#1a2744]">
          <div className="text-[#00d4ff] font-bold text-sm tracking-wider">GEOSEER // IMAGE GEOLOCATION</div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={16} /></button>
        </div>

        <div className="grid grid-cols-2 gap-4 p-4">
          <div className="space-y-3">
            <label className="block text-xs text-slate-400">Upload 1-3 screenshot / photo (JPG, PNG, WEBP)</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 3))}
              className="w-full text-xs text-slate-300 file:mr-2 file:px-3 file:py-1.5 file:bg-[#00d4ff]/10 file:border file:border-[#00d4ff]/40 file:rounded file:text-[#00d4ff]"
            />
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">Mode</span>
              <button
                onClick={() => setMode("fast")}
                className={`px-2 py-1 rounded border ${mode === "fast" ? "text-[#00d4ff] border-[#00d4ff]/40 bg-[#00d4ff]/10" : "text-slate-500 border-[#1a2744]"}`}
              >
                FAST
              </button>
              <button
                onClick={() => setMode("agent")}
                className={`px-2 py-1 rounded border ${mode === "agent" ? "text-[#a78bfa] border-[#a78bfa]/40 bg-[#a78bfa]/10" : "text-slate-500 border-[#1a2744]"}`}
              >
                AGENT
              </button>
            </div>

            <button
              onClick={runAnalysis}
              disabled={!files.length || loading}
              className="w-full py-2 text-xs bg-[#00d4ff]/10 border border-[#00d4ff] text-[#00d4ff] rounded hover:bg-[#00d4ff]/20 disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {loading ? <Loader size={12} className="animate-spin" /> : <Upload size={12} />}
              Analyze Location
            </button>

            {error && <div className="text-xs text-[#ff3366] bg-[#ff3366]/10 border border-[#ff3366]/30 rounded p-2">{error}</div>}

            <div className="h-[360px] border border-[#1a2744] rounded bg-[#0a0e1a] p-2 overflow-auto">
              {previews.length ? (
                <div className={`grid gap-2 ${previews.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                  {previews.map((p) => (
                    <div key={p.url} className="border border-[#1a2744] rounded overflow-hidden bg-black/20">
                      <div className="text-[10px] text-slate-500 px-2 py-1 truncate">{p.name}</div>
                      <img src={p.url} alt={p.name} className="w-full h-32 object-contain bg-[#050814]" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-slate-600">No image selected</div>
              )}
            </div>
            <div className="p-2 border border-[#1a2744] rounded text-xs">
              <div className="text-slate-500 mb-1">Analysis History</div>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {history.length === 0 && <div className="text-slate-600">No analyses yet.</div>}
                {history.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => {
                      setResult(h.snapshot);
                      setSelectedCandidate(h.snapshot?.candidates?.[0] || null);
                    }}
                    className="w-full text-left px-2 py-1 border border-[#1a2744] rounded hover:bg-[#1a2744]/40"
                  >
                    <span className="text-slate-300">{h.topName}</span>{" "}
                    <span className="text-slate-500">({h.confidence}%, {h.imageCount} img, {h.mode})</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs text-slate-500 tracking-widest">RESULT</div>
            {!result && <div className="text-xs text-slate-600 p-2 border border-[#1a2744] rounded">Analiz sonucu burada görünecek.</div>}

            {result && (
              <>
                <div className="p-2 border border-[#1a2744] rounded text-xs">
                  <div className="text-slate-500">Scene</div>
                  <div className="text-slate-200 mt-1">{result.scene_type || "Unknown"}</div>
                </div>
                <div className="p-2 border border-[#1a2744] rounded text-xs">
                  <div className="text-slate-500">Primary Guess</div>
                  <div className="text-slate-200 mt-1">
                    {(result.primary_location_guess?.name || "Unknown")} / {(result.primary_location_guess?.country || "Unknown")}
                  </div>
                  <div className="text-slate-500 mt-1">
                    LAT: {result.primary_location_guess?.lat ?? "-"} LON: {result.primary_location_guess?.lon ?? "-"}
                  </div>
                </div>
                <div className="p-2 border border-[#1a2744] rounded text-xs">
                  <div className="text-slate-500">Confidence</div>
                  <div className={`font-bold mt-1 ${levelColor(result.confidence || 0)}`}>{result.confidence || 0}%</div>
                </div>
                <div className="p-2 border border-[#1a2744] rounded text-xs">
                  <div className="text-slate-500 mb-1">Candidate Ranking</div>
                  <div className="space-y-1 max-h-28 overflow-y-auto">
                    {(result.candidates || []).slice(0, 10).map((c, i) => (
                      <button
                        key={`${c.name || "c"}-${i}`}
                        onClick={() => setSelectedCandidate(c)}
                        className={`w-full text-left px-2 py-1 rounded border ${selectedCandidate?.rank === c.rank ? "border-[#00ff88]/40 bg-[#00ff88]/10" : "border-[#1a2744] hover:bg-[#1a2744]/40"}`}
                      >
                        <span className="text-slate-300">#{c.rank} {c.name || "Unknown"} / {c.country || "Unknown"}</span>
                        <span className="text-slate-500 ml-2">score:{c.score} votes:{c.votes}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="p-2 border border-[#1a2744] rounded text-xs">
                  <div className="text-slate-500">Geo Clues</div>
                  <ul className="text-slate-300 mt-1 space-y-1">
                    {(result.geo_clues || []).slice(0, 6).map((x, i) => <li key={i}>- {x}</li>)}
                  </ul>
                </div>
                <div className="p-2 border border-[#1a2744] rounded text-xs">
                  <div className="text-slate-500 mb-2">Map Projection</div>
                  <div className="h-[220px] rounded overflow-hidden border border-[#1a2744]">
                    <MapContainer
                      key={`${mapCenter[0]}:${mapCenter[1]}`}
                      center={mapCenter}
                      zoom={selectedCandidate?.lat || result?.primary_location_guess?.lat ? 9 : 2}
                      style={{ width: "100%", height: "100%" }}
                    >
                      <TileLayer
                        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                        attribution='&copy; <a href="https://carto.com">CARTO</a>'
                      />
                      {typeof result?.primary_location_guess?.lat === "number" && typeof result?.primary_location_guess?.lon === "number" && (
                        <>
                          <CircleMarker
                            center={[result.primary_location_guess.lat, result.primary_location_guess.lon]}
                            radius={9}
                            pathOptions={{ color: "#00ff88", fillColor: "#00ff88", fillOpacity: 0.6, weight: 2 }}
                          >
                            <Popup>
                              Primary: {result.primary_location_guess.name || "Unknown"} / {result.primary_location_guess.country || "Unknown"}
                            </Popup>
                          </CircleMarker>
                          {typeof result.primary_location_guess.radius_km === "number" && result.primary_location_guess.radius_km > 0 && (
                            <Circle
                              center={[result.primary_location_guess.lat, result.primary_location_guess.lon]}
                              radius={result.primary_location_guess.radius_km * 1000}
                              pathOptions={{ color: "#00ff88", fillColor: "#00ff88", fillOpacity: 0.08, weight: 1 }}
                            />
                          )}
                        </>
                      )}
                      {typeof selectedCandidate?.lat === "number" && typeof selectedCandidate?.lon === "number" && (
                        <>
                          <CircleMarker
                            center={[selectedCandidate.lat, selectedCandidate.lon]}
                            radius={10}
                            pathOptions={{ color: "#00d4ff", fillColor: "#00d4ff", fillOpacity: 0.2, weight: 2 }}
                          >
                            <Popup>
                              Selected candidate #{selectedCandidate.rank}: {selectedCandidate.name || "Unknown"} / {selectedCandidate.country || "Unknown"}
                            </Popup>
                          </CircleMarker>
                          {typeof selectedCandidate.radius_km === "number" && selectedCandidate.radius_km > 0 && (
                            <Circle
                              center={[selectedCandidate.lat, selectedCandidate.lon]}
                              radius={selectedCandidate.radius_km * 1000}
                              pathOptions={{ color: "#00d4ff", fillColor: "#00d4ff", fillOpacity: 0.06, weight: 1 }}
                            />
                          )}
                        </>
                      )}
                      {(result.alternative_locations || []).map((alt, i) => {
                        if (typeof alt.lat !== "number" || typeof alt.lon !== "number") return null;
                        return (
                          <CircleMarker
                            key={`${alt.name || "alt"}-${i}`}
                            center={[alt.lat, alt.lon]}
                            radius={6}
                            pathOptions={{ color: "#ffaa00", fillColor: "#ffaa00", fillOpacity: 0.5, weight: 1.5 }}
                          >
                            <Popup>
                              Alternative: {alt.name || "Unknown"} / {alt.country || "Unknown"}
                            </Popup>
                          </CircleMarker>
                        );
                      })}
                    </MapContainer>
                  </div>
                </div>
                <div className="p-2 border border-[#1a2744] rounded text-xs">
                  <div className="text-slate-500">Next Steps</div>
                  <ul className="text-slate-300 mt-1 space-y-1">
                    {(result.recommended_next_steps || []).slice(0, 5).map((x, i) => <li key={i}>- {x}</li>)}
                  </ul>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
