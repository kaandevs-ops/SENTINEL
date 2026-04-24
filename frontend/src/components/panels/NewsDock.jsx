import { useMemo, useRef, useState } from "react";
import { ExternalLink, Newspaper, X, Crosshair } from "lucide-react";
import { useSentinelStore } from "../../store/useSentinelStore";

function formatSeenDate(seendate) {
  if (!seendate) return "";
  // GDELT seendate often: "20260423143000"
  if (/^\d{14}$/.test(seendate)) {
    const y = seendate.slice(0, 4);
    const mo = seendate.slice(4, 6);
    const d = seendate.slice(6, 8);
    const h = seendate.slice(8, 10);
    const mi = seendate.slice(10, 12);
    return `${y}-${mo}-${d} ${h}:${mi}Z`;
  }
  return String(seendate).slice(0, 16).replace("T", " ");
}

function clampText(s, max = 140) {
  const t = (s || "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

function NewsDetail({ item, onClose }) {
  const focus = () => {
    if (!item) return;
    const lat = item.latitude;
    const lon = item.longitude;
    if (typeof lat === "number" && typeof lon === "number" && typeof window.__sentinelFlyTo === "function") {
      window.__sentinelFlyTo(lon, lat, 1_200_000);
    }
  };

  if (!item) return null;
  const hasGeo = typeof item.latitude === "number" && typeof item.longitude === "number";

  return (
    <div className="absolute inset-0 z-30 bg-black/60 flex items-end justify-center" onClick={onClose}>
      <div
        className="w-[min(980px,calc(100vw-24px))] mb-3 bg-[#0d1424] border border-[#1a2744] rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#1a2744]">
          <div className="flex items-center gap-2">
            <Newspaper size={14} className="text-[#00d4ff]" />
            <div className="text-[#00d4ff] font-bold text-xs tracking-widest">NEWS DETAIL</div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200">
            <X size={16} />
          </button>
        </div>
        <div className="p-4">
          <div className="text-slate-100 font-semibold leading-snug text-sm">
            {item.title || "Untitled"}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="font-mono">{item.source || "-"}</span>
            {item.country ? <span className="font-mono">{String(item.country).toUpperCase()}</span> : null}
            {item.seendate ? <span className="font-mono">{formatSeenDate(item.seendate)}</span> : null}
            {item.geo_precision ? <span className="font-mono">GEO:{item.geo_precision}</span> : null}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#00d4ff]/30 bg-[#00d4ff]/10 text-[#00d4ff] text-[11px] hover:bg-[#00d4ff]/20"
              >
                <ExternalLink size={12} />
                Open Source
              </a>
            ) : null}
            <button
              onClick={focus}
              disabled={!hasGeo}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-[#00ff88]/30 bg-[#00ff88]/10 text-[#00ff88] text-[11px] hover:bg-[#00ff88]/20 disabled:opacity-40 disabled:hover:bg-[#00ff88]/10"
            >
              <Crosshair size={12} />
              Focus on Globe
            </button>
          </div>

          <div className="mt-3 text-[11px] text-slate-400 leading-relaxed">
            {hasGeo ? (
              <div className="font-mono">
                LAT {item.latitude.toFixed(3)} / LON {item.longitude.toFixed(3)}
              </div>
            ) : (
              <div className="text-slate-600">No location metadata for this item.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NewsDock() {
  const news = useSentinelStore((s) => s.news);
  const feedHealth = useSentinelStore((s) => s.feedHealth?.news);
  const mapTheme = useSentinelStore((s) => s.mapTheme);
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(18);
  const [selected, setSelected] = useState(null);
  const scrollerRef = useRef(null);

  const accent =
    mapTheme === "nvg" ? "#39ff14" :
    mapTheme === "flir" ? "#ff6600" :
    mapTheme === "crt" ? "#00ff88" :
    mapTheme === "noir" ? "#ffffff" :
    "#00d4ff";

  const items = useMemo(() => {
    const rows = Array.isArray(news) ? news : [];
    // Stable sort by seendate desc (best-effort)
    return [...rows].sort((a, b) => String(b?.seendate || "").localeCompare(String(a?.seendate || "")));
  }, [news]);

  const status = feedHealth?.status || "unknown";
  const statusColor =
    status === "healthy" ? "#00ff88" :
    status === "degraded" ? "#ffaa00" :
    status === "stale" ? "#ff3366" :
    "#64748b";

  return (
    <div className="relative shrink-0 border-t border-[#1a2744] bg-[#0a0e1a]/95">
      <div className="px-3 py-1.5 flex items-center justify-between">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-[10px] tracking-[0.25em] font-bold hover:opacity-90"
          style={{ color: accent }}
        >
          <Newspaper size={12} />
          NEWS FEED
          <span className="text-slate-600 tracking-widest font-mono">({items.length})</span>
        </button>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[10px] font-mono text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor }} />
            {status.toUpperCase()}
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-slate-600 hover:text-slate-200"
            title="Hide"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {open && (
        <div
          className="px-3 pb-3"
          onWheel={(e) => {
            // Edge-like: wheel down expands the dock (bottom-sheet feel).
            if (e.deltaY > 6 && !expanded) setExpanded(true);
            if (e.deltaY < -6) {
              const el = scrollerRef.current;
              if (!el || el.scrollTop <= 0) setExpanded(false);
            }
          }}
        >
          <div
            ref={scrollerRef}
            className="rounded-lg border border-[#1a2744] bg-[#0d1424]/40 overflow-y-auto"
            style={{
              maxHeight: expanded ? 260 : 96,
              transition: "max-height 180ms ease",
            }}
            onScroll={(e) => {
              const el = e.currentTarget;
              const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
              if (nearBottom && visibleCount < items.length) {
                setVisibleCount((n) => Math.min(items.length, n + 18));
              }
            }}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a2744]/70">
              <div className="text-[10px] font-mono text-slate-500">
                Wheel down to expand · Wheel up to collapse
              </div>
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-[10px] font-mono px-2 py-1 rounded border border-[#1a2744] text-slate-400 hover:text-slate-200 hover:bg-[#1a2744]/30"
              >
                {expanded ? "COLLAPSE" : "EXPAND"}
              </button>
            </div>

            {items.length === 0 && (
              <div className="text-xs text-slate-600 py-6 px-3">No recent news.</div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 p-3">
              {items.slice(0, visibleCount).map((n, idx) => {
                const key = `${n?.id || n?.url || n?.title || "news"}:${n?.seendate || ""}:${idx}`;
                const hasGeo = typeof n?.latitude === "number" && typeof n?.longitude === "number";
                return (
                  <button
                    key={key}
                    onClick={() => setSelected(n)}
                    className="text-left p-3 rounded-lg border border-[#1a2744] bg-[#0d1424]/70 hover:bg-[#0d1424] transition-colors"
                  >
                    <div className="text-[11px] font-mono tracking-widest mb-1" style={{ color: accent, opacity: 0.8 }}>
                      {n?.source ? String(n.source).toUpperCase().slice(0, 18) : "SOURCE"}
                      {n?.country ? <span className="text-slate-600"> · {String(n.country).toUpperCase()}</span> : null}
                    </div>
                    <div className="text-sm text-slate-200 leading-snug line-clamp-3">
                      {clampText(n?.title, 160) || "Untitled"}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-slate-600 font-mono">
                      <span>{formatSeenDate(n?.seendate)}</span>
                      <span className={hasGeo ? "text-[#00ff88]" : "text-slate-700"}>{hasGeo ? "GEO" : "NO-GEO"}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {visibleCount < items.length && (
              <div className="px-3 pb-3 text-[10px] font-mono text-slate-600">
                Showing {visibleCount}/{items.length} · scroll for more
              </div>
            )}
          </div>
        </div>
      )}

      <NewsDetail item={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

