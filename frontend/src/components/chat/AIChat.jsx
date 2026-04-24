import { useState, useRef, useEffect } from "react";
import { X, Send, Loader } from "lucide-react";
import { useSentinelStore } from "../../store/useSentinelStore";

export default function AIChat({ sendQuery, onClose }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    { role: "ai", text: "SENTINEL AI hazır. Global aktivite hakkında Türkçe veya İngilizce sorabilirsin." }
  ]);
  const [loading, setLoading] = useState(false);
  const [copilotLayers, setCopilotLayers] = useState([]);
  const bottomRef = useRef(null);
  const toggleLayer = useSentinelStore((s) => s.toggleLayer);
  const activeLayers = useSentinelStore((s) => s.activeLayers);

  useEffect(() => {
    const handler = (e) => {
      setMessages((m) => [...m, { role: "ai", text: e.detail }]);
      setLoading(false);
    };
    window.addEventListener("sentinel-ai-response", handler);
    return () => window.removeEventListener("sentinel-ai-response", handler);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = () => {
    if (!input.trim() || loading) return;
    const current = input.trim();
    setMessages((m) => [...m, { role: "user", text: current }]);
    setLoading(true);
    // Copilot structured command: /copilot <objective>
    if (current.toLowerCase().startsWith("/copilot")) {
      const objective = current.replace(/^\/copilot\s*/i, "").trim() || "Global operational posture";
      fetch("/api/intelligence/copilot/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective }),
      })
        .then((r) => r.json())
        .then((payload) => {
          const plan = payload?.data || payload;
          const actions = Array.isArray(plan?.actions) ? plan.actions.slice(0, 5) : [];
          const layers = Array.isArray(plan?.recommended_layers) ? plan.recommended_layers : [];
          setCopilotLayers(layers);
          const lines = [
            `COPILOT // ${String(plan?.priority || "medium").toUpperCase()}`,
            plan?.mission_summary || "No mission summary.",
            ...(Array.isArray(plan?.recommended_layers) && plan.recommended_layers.length
              ? [`Layers: ${plan.recommended_layers.join(", ")}`]
              : []),
            ...actions.map((a, i) => `${i + 1}) ${a.title || "Action"} (${a.eta_min || 0}m) - ${a.why || ""}`),
          ];
          setMessages((m) => [...m, { role: "ai", text: lines.join("\n") }]);
          setLoading(false);
        })
        .catch(() => {
          setMessages((m) => [...m, { role: "ai", text: "Copilot plan alınamadı." }]);
          setCopilotLayers([]);
          setLoading(false);
        });
      setInput("");
      return;
    }
    sendQuery(current);
    setInput("");
  };

  const QUICK_PROMPTS = [
    "Türkiye için en kritik 5 tehdidi özetle ve hangi katmanları açmam gerektiğini söyle.",
    "Son operasyon olaylarından risk artışını analiz et ve aksiyon planı ver.",
    "News + Threats + Wildfires feedlerini tek raporda birleştir.",
    "Şu anda hangi bölgeler hotspot? kısa ve maddeli cevap ver.",
    "/copilot Türkiye ve çevresi için 30 dakikalık operasyon planı üret.",
  ];

  const normalizeLayerKey = (raw) => {
    const s = String(raw || "").trim().toLowerCase();
    const map = {
      aircraft: "aircraft",
      flights: "aircraft",
      ships: "ships",
      maritime: "ships",
      satellites: "satellites",
      persons: "persons",
      earthquakes: "earthquakes",
      seismic: "earthquakes",
      threats: "threats",
      weatheralerts: "weatherAlerts",
      weather: "weatherAlerts",
      news: "news",
      wildfires: "wildfires",
      cameras: "cameras",
      conflicts: "conflicts",
      cyberiocs: "cyberIocs",
      iocs: "cyberIocs",
      gpsjamming: "gpsJamming",
      routeops: "routeOps",
      radaroverlay: "radarOverlay",
      satelliteoverlay: "satelliteOverlay",
    };
    const cleaned = s.replace(/[^a-z]/g, "");
    return map[cleaned] || null;
  };

  const applyCopilotLayers = () => {
    if (!copilotLayers.length) return;
    const keys = copilotLayers.map(normalizeLayerKey).filter(Boolean);
    const unique = [...new Set(keys)];
    unique.forEach((k) => {
      if (!activeLayers[k]) toggleLayer(k);
    });
    setMessages((m) => [...m, { role: "ai", text: `Copilot layers applied: ${unique.join(", ") || "-"}` }]);
  };

  return (
    <div className="bg-[#0d1424] border border-[#1a2744] rounded-xl flex flex-col shadow-2xl" style={{ height: 420 }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a2744]">
        <span className="text-[#00d4ff] text-xs font-bold tracking-wider">🤖 AI ANALYST</span>
        <button onClick={onClose}><X size={14} className="text-slate-500 hover:text-white" /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        <div className="flex flex-wrap gap-1.5 mb-1">
          {QUICK_PROMPTS.map((p, i) => (
            <button
              key={i}
              onClick={() => {
                if (loading) return;
                setInput(p);
              }}
              className="text-[10px] px-2 py-1 rounded border border-[#1a2744] text-slate-400 hover:text-slate-200 hover:border-[#334155] hover:bg-[#1a2744]/40"
            >
              Quick {i + 1}
            </button>
          ))}
        </div>
        {messages.map((m, i) => (
          <div key={i} className={`text-xs ${m.role === "user" ? "text-right" : ""}`}>
            <span className={`inline-block px-2 py-1.5 rounded max-w-[90%] text-left leading-relaxed ${
              m.role === "user"
                ? "bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/20"
                : "bg-[#1a2744] text-slate-300"
            }`}>
              {m.text}
            </span>
          </div>
        ))}
        {loading && (
          <div className="text-xs">
            <span className="inline-flex items-center gap-2 px-2 py-1.5 rounded bg-[#1a2744] text-slate-400">
              <Loader size={10} className="animate-spin" />
              AI analiz ediyor...
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2 p-2 border-t border-[#1a2744]">
        {copilotLayers.length > 0 && (
          <button
            onClick={applyCopilotLayers}
            className="text-[10px] px-2 py-1 rounded border border-[#00ff88]/40 text-[#00ff88] hover:bg-[#00ff88]/10"
          >
            Apply Layers
          </button>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Soru sor... (örn: Türkiye'de uçak var mı?)"
          className="flex-1 bg-[#0a0e1a] border border-[#1a2744] rounded px-2 py-1.5 text-xs text-slate-300 outline-none focus:border-[#00d4ff]"
          disabled={loading}
        />
        <button
          onClick={send}
          disabled={loading}
          className="text-[#00d4ff] hover:text-white disabled:opacity-40"
        >
          {loading ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  );
}
