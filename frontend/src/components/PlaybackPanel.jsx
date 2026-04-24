import { useEffect, useRef, useState, useCallback } from "react";
import { useSentinelStore } from "../store/useSentinelStore";

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];

function fmt(isoStr) {
  if (!isoStr) return "--:--:--";
  try { return new Date(isoStr).toISOString().replace("T", " ").slice(0, 19) + " UTC"; }
  catch { return isoStr; }
}
function fmtShort(isoStr) {
  if (!isoStr) return "--:--";
  try { return new Date(isoStr).toISOString().slice(11, 19); }
  catch { return ""; }
}

export default function PlaybackPanel({ onClose }) {
  const [range, setRange] = useState(null);
  const [timestamps, setTs] = useState([]);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(2);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("idle");
  const [entityCount, setEntityCount] = useState(0);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);
  const setPlaybackData = useSentinelStore((s) => s.setPlaybackData);
  const speed = SPEEDS[speedIdx];

  useEffect(() => { fetchRange(); }, []);

  async function fetchRange() {
    try {
      setStatus("loading");
      const res = await fetch("/api/playback/range");
      const json = await res.json();
      const data = json.data || json;
      if (!data.has_data) {
        setError("Henüz snapshot yok. Backend'i birkaç dakika çalıştırın (her 60s bir snapshot alınır).");
        setStatus("error"); return;
      }
      setRange(data); setError(null);
      const res2 = await fetch("/api/playback/frames?limit=500");
      const json2 = await res2.json();
      const data2 = json2.data || json2;
      setTs(data2.timestamps || []);
      setFrameIdx(0); setStatus("paused");
    } catch (e) { setError("API hatası: " + e.message); setStatus("error"); }
  }

  const loadFrame = useCallback(async (idx) => {
    if (!timestamps.length) return;
    const ts = timestamps[idx]; if (!ts) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/playback/snapshot?ts=${encodeURIComponent(ts)}&limit=3000`);
      const json = await res.json();
      const data = json.data || json;
      setPlaybackData({
        aircraft: (data.entities || []).filter(e => e.entity_type === "aircraft").map(e => ({
          id: e.id, callsign: e.name, country: e.country,
          latitude: e.latitude, longitude: e.longitude, altitude: e.altitude,
          speed: e.speed, heading: e.heading, on_ground: e.on_ground || false, trail: [], type: "aircraft",
        })),
        ships: (data.entities || []).filter(e => e.entity_type === "ship").map(e => ({
          id: e.id, mmsi: e.id, name: e.name,
          latitude: e.latitude, longitude: e.longitude,
          speed: e.speed, heading: e.heading, flag: e.flag, ship_type: e.ship_type, trail: [],
        })),
        timestamp: data.timestamp,
      });
      setEntityCount(data.count || 0);
    } catch (e) { console.error("Frame load error:", e); }
    finally { setLoading(false); }
  }, [timestamps, setPlaybackData]);

  useEffect(() => {
    if (timestamps.length && status !== "idle") loadFrame(frameIdx);
  }, [frameIdx, timestamps]);

  useEffect(() => {
    if (playing) {
      setStatus("playing");
      intervalRef.current = setInterval(() => {
        setFrameIdx(prev => {
          if (prev >= timestamps.length - 1) { setPlaying(false); setStatus("paused"); return prev; }
          return prev + 1;
        });
      }, 1000 / speed);
    } else {
      clearInterval(intervalRef.current);
      if (status === "playing") setStatus("paused");
    }
    return () => clearInterval(intervalRef.current);
  }, [playing, speed, timestamps.length]);

  useEffect(() => {
    return () => { clearInterval(intervalRef.current); setPlaybackData(null); };
  }, []);

  const progress = timestamps.length > 1 ? (frameIdx / (timestamps.length - 1)) * 100 : 0;
  const currentTs = timestamps[frameIdx] || null;

  return (
    <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-[2000] w-[680px] max-w-[95vw]" style={{fontFamily:"monospace"}}>
      <div className="bg-[#0a0e1a]/97 border border-[#a78bfa]/50 rounded-lg shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#1a2744] bg-[#0d1424]">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#a78bfa] animate-pulse" />
            <span className="text-[11px] tracking-widest text-[#a78bfa] font-bold">PLAYBACK MODE</span>
            {range && <span className="text-[9px] text-slate-500 ml-2">{range.frame_count} FRAMES · {(range.total_entities||0).toLocaleString()} ENTITIES</span>}
          </div>
          <div className="flex items-center gap-3">
            {loading && <span className="text-[9px] text-[#00d4ff] animate-pulse">LOADING…</span>}
            <span className={`text-[9px] tracking-widest ${status==="playing"?"text-[#00ff88]":status==="error"?"text-[#ff3366]":"text-slate-500"}`}>{status.toUpperCase()}</span>
            <button onClick={onClose} className="text-slate-600 hover:text-white text-xs px-1">✕</button>
          </div>
        </div>
        {error && (
          <div className="px-4 py-3 text-[11px] text-[#ff3366] bg-[#ff3366]/10 border-b border-[#ff3366]/20">
            ⚠ {error} <button onClick={fetchRange} className="ml-3 underline">Retry</button>
          </div>
        )}
        {!error && (
          <>
            <div className="px-4 py-2 flex items-center justify-between border-b border-[#1a2744]">
              <div><div className="text-[9px] text-slate-600 tracking-widest">CURRENT FRAME</div><div className="text-[13px] text-[#00d4ff] tracking-wider">{fmt(currentTs)}</div></div>
              <div className="text-right"><div className="text-[9px] text-slate-600">ENTITIES</div><div className="text-[13px] text-[#a78bfa]">{entityCount.toLocaleString()}</div></div>
              <div className="text-right"><div className="text-[9px] text-slate-600">FRAME</div><div className="text-[13px] text-slate-300">{frameIdx+1} / {timestamps.length}</div></div>
            </div>
            <div className="px-4 py-2">
              <input type="range" min={0} max={Math.max(0,timestamps.length-1)} value={frameIdx}
                onChange={e=>{setPlaying(false);setFrameIdx(Number(e.target.value));}}
                className="w-full h-1.5 rounded appearance-none cursor-pointer"
                style={{background:`linear-gradient(to right,#a78bfa ${progress}%,#1a2744 ${progress}%)`,outline:"none"}}
                disabled={!timestamps.length}/>
              <div className="flex justify-between mt-1">
                <span className="text-[9px] text-slate-600">{fmtShort(timestamps[0])}</span>
                <span className="text-[9px] text-slate-600">{fmtShort(timestamps[timestamps.length-1])}</span>
              </div>
            </div>
            <div className="px-4 py-2 border-t border-[#1a2744] flex items-center gap-3">
              <button onClick={()=>{setPlaying(false);setFrameIdx(0);}} className="text-slate-400 hover:text-white text-xs">⏮</button>
              <button onClick={()=>{setPlaying(false);setFrameIdx(i=>Math.max(0,i-1));}} className="text-slate-400 hover:text-white text-xs">⏪</button>
              <button onClick={()=>setPlaying(p=>!p)} disabled={!timestamps.length}
                className={`px-3 py-1 rounded text-[11px] font-bold tracking-wider transition-all ${playing?"bg-[#a78bfa]/30 border border-[#a78bfa]/60 text-[#a78bfa]":"bg-[#00ff88]/10 border border-[#00ff88]/40 text-[#00ff88] hover:bg-[#00ff88]/20"} disabled:opacity-40`}>
                {playing?"⏸ PAUSE":"▶ PLAY"}
              </button>
              <button onClick={()=>{setPlaying(false);setFrameIdx(i=>Math.min(timestamps.length-1,i+1));}} className="text-slate-400 hover:text-white text-xs">⏩</button>
              <button onClick={()=>{setPlaying(false);setFrameIdx(timestamps.length-1);}} className="text-slate-400 hover:text-white text-xs">⏭</button>
              <div className="ml-auto flex items-center gap-1">
                <span className="text-[9px] text-slate-500">SPEED</span>
                <div className="flex border border-[#1a2744] rounded overflow-hidden">
                  {SPEEDS.map((s,i)=>(
                    <button key={s} onClick={()=>setSpeedIdx(i)}
                      className={`px-1.5 py-0.5 text-[9px] transition-colors ${speedIdx===i?"bg-[#a78bfa]/30 text-[#a78bfa]":"text-slate-500 hover:text-slate-300"}`}>
                      {s}×
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
