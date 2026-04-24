import { useState } from "react";
import { useSentinelStore } from "../../store/useSentinelStore";

// Referans görsellerdeki tema sırası ve ikonlar
const THEMES = [
  { key: "normal", label: "Normal", icon: "○", color: "#00d4ff" },
  { key: "crt",    label: "CRT",    icon: "■", color: "#00ff88" },
  { key: "nvg",    label: "NVG",    icon: "☾", color: "#39ff14" },
  { key: "flir",   label: "FLIR",   icon: "✕", color: "#ff6600" },
  { key: "anime",  label: "Anime",  icon: "✦", color: "#f472b6" },
  { key: "noir",   label: "Noir",   icon: "◑", color: "#aaaaaa" },
  { key: "snow",   label: "Snow",   icon: "❄", color: "#bae6fd" },
  { key: "ai",     label: "AI Edit",icon: "●", color: "#a78bfa" },
];

// Her tema için sağ panel parametreleri
const THEME_PARAMS = {
  normal: [],
  crt: [
    { key: "pixelation",  label: "Pixelation",  default: 50 },
    { key: "distortion",  label: "Distortion",  default: 75 },
    { key: "instability", label: "Instability", default: 40 },
  ],
  nvg: [
    { key: "gain",       label: "Gain",      default: 60 },
    { key: "bloom",      label: "Bloom",     default: 70 },
    { key: "scanlines",  label: "Scanlines", default: 80 },
    { key: "pixelation", label: "Pixelation",default: 30 },
  ],
  flir: [
    { key: "sensitivity", label: "Sensitivity", default: 60 },
    { key: "bloom",       label: "Bloom",        default: 70 },
    { key: "whot_bhot",   label: "WHOT/BHOT",    default: 50 },
    { key: "pixelation",  label: "Pixelation",   default: 30 },
  ],
  anime: [],
  noir:  [],
  snow:  [],
  ai:    [],
};

export default function ThemeControls() {
  const { mapTheme, setMapTheme } = useSentinelStore();

  // Tema başına slider değerleri — local state yeterli (Cesium filter'a ileride bağlanabilir)
  const [params, setParams] = useState(() => {
    const init = {};
    Object.entries(THEME_PARAMS).forEach(([theme, list]) => {
      init[theme] = {};
      list.forEach((p) => { init[theme][p.key] = p.default; });
    });
    return init;
  });

  const [bloom, setBloom]   = useState(100);
  const [sharpen, setSharpen] = useState(56);
  const [panoptic, setPanoptic] = useState(6);
  const [hudLayout] = useState("Tactical");

  const activeTheme = THEMES.find((t) => t.key === mapTheme) || THEMES[0];
  const themeParams = THEME_PARAMS[mapTheme] || [];

  const setParam = (key, val) => {
    setParams((prev) => ({
      ...prev,
      [mapTheme]: { ...prev[mapTheme], [key]: val },
    }));
  };

  return (
    <div className="sentinel-panel p-2">
      {/* Başlık */}
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-[#00d4ff] text-[10px] font-bold tracking-widest">DISPLAY MODE</span>
        <span
          className="text-[9px] font-bold tracking-widest"
          style={{ color: activeTheme.color }}
        >
          {activeTheme.label.toUpperCase()}
        </span>
      </div>

      {/* ── BLOOM ── */}
      <div className="mb-2 px-1">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[10px] font-bold tracking-wider" style={{ color: "#00d4ff" }}>
            + BLOOM
          </span>
          <span className="text-[9px] text-slate-400 font-mono">{bloom}%</span>
        </div>
        <input
          type="range" min={0} max={100} value={bloom}
          onChange={(e) => setBloom(Number(e.target.value))}
          className="w-full h-0.5 accent-[#00d4ff] cursor-pointer"
        />
      </div>

      {/* ── SHARPEN ── */}
      <div className="mb-2 px-1">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[10px] font-bold tracking-wider text-slate-300">
            ● SHARPEN
          </span>
          <span className="text-[9px] text-slate-400 font-mono">{sharpen}%</span>
        </div>
        <input
          type="range" min={0} max={100} value={sharpen}
          onChange={(e) => setSharpen(Number(e.target.value))}
          className="w-full h-0.5 accent-[#00d4ff] cursor-pointer"
        />
      </div>

      {/* ── HUD ── */}
      <div className="mb-2 px-1 py-1 border border-[#1a2744] rounded">
        <div className="text-[10px] font-bold tracking-wider text-slate-300 mb-1">HUD</div>
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-slate-500">LAYOUT</span>
          <span className="text-[9px] text-[#00d4ff] font-mono border border-[#1a2744] px-1.5 py-0.5 rounded">
            {hudLayout} ▼
          </span>
        </div>
      </div>

      {/* ── PANOPTIC ── */}
      <div className="mb-2 px-1 py-1 border border-[#00ff88]/30 bg-[#00ff88]/5 rounded">
        <div className="flex items-center gap-1 mb-1">
          <span className="w-2 h-2 rounded-sm bg-[#00ff88] inline-block" />
          <span className="text-[10px] font-bold tracking-wider text-[#00ff88]">PANOPTIC</span>
        </div>
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[9px] text-slate-500">DENSITY</span>
          <span className="text-[9px] text-slate-400 font-mono">{panoptic}%</span>
        </div>
        <input
          type="range" min={1} max={100} value={panoptic}
          onChange={(e) => setPanoptic(Number(e.target.value))}
          className="w-full h-0.5 accent-[#00ff88] cursor-pointer"
        />
      </div>

      {/* ── CLEAN UI ── */}
      <button className="w-full text-[10px] font-bold tracking-widest text-slate-400 border border-[#1a2744] hover:border-[#00d4ff]/40 hover:text-[#00d4ff] py-1 rounded mb-2 transition-all">
        CLEAN UI
      </button>

      {/* ── PARAMETERS (tema özelinde) ── */}
      {themeParams.length > 0 && (
        <div className="px-1 pt-1 border-t border-[#1a2744]">
          <div className="text-[9px] font-bold tracking-widest text-slate-500 mb-1.5">PARAMETERS</div>
          <div className="space-y-1.5">
            {themeParams.map((p) => (
              <div key={p.key}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[9px] text-slate-400">{p.label}</span>
                  <span className="text-[9px] text-slate-500 font-mono">
                    {params[mapTheme]?.[p.key] ?? p.default}
                  </span>
                </div>
                <input
                  type="range" min={0} max={100}
                  value={params[mapTheme]?.[p.key] ?? p.default}
                  onChange={(e) => setParam(p.key, Number(e.target.value))}
                  className="w-full h-0.5 accent-[#00d4ff] cursor-pointer"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TEMA SEÇIM GRID (kompakt) ── */}
      <div className="mt-2 pt-2 border-t border-[#1a2744]">
        <div className="grid grid-cols-4 gap-1">
          {THEMES.map((t) => {
            const isActive = mapTheme === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setMapTheme(t.key)}
                title={t.label}
                className="flex flex-col items-center py-1 px-0.5 rounded border transition-all"
                style={
                  isActive
                    ? { borderColor: t.color, background: t.color + "22", color: t.color }
                    : { borderColor: "#1a2744", background: "transparent", color: "#475569" }
                }
              >
                <span className="text-[11px] leading-none">{t.icon}</span>
                <span className="text-[8px] mt-0.5 font-bold tracking-wide">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}