import { useState, useEffect } from "react";
import { Settings, Check, X, Loader } from "lucide-react";
import { fetchJson } from "../../lib/apiClient";

const PROVIDERS = [
  { id: "claude",  label: "Claude",  models: ["claude-sonnet-4-20250514", "claude-opus-4-5-20251101", "claude-haiku-4-5-20251001"], needsKey: true },
  { id: "openai",  label: "GPT-4",   models: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"], needsKey: true },
  { id: "gemini",  label: "Gemini",  models: ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"], needsKey: true },
  { id: "groq",    label: "Groq",    models: ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "mixtral-8x7b-32768"], needsKey: true },
  { id: "ollama",  label: "Ollama",  models: ["llama3.1:8b", "llama3.2", "llama3.1", "mistral", "qwen3.5:latest", "phi3", "gemma2"], needsKey: false },
];

export default function AIProviderPanel({ onClose }) {
  const [status, setStatus] = useState(null);
  const [selected, setSelected] = useState("claude");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchJson("/api/ai/providers")
      .then(d => {
        setStatus(d);
        setSelected(d.active || "claude");
      })
      .catch(() => setStatus({ error: "Backend bağlantısı yok" }));
  }, []);

  const selectedInfo = PROVIDERS.find(p => p.id === selected);

  const handleSave = async () => {
    setSaving(true);
    setTestResult(null);
    const body = { provider: selected, model, api_key: apiKey };
    if (selected === "ollama") body.base_url = baseUrl;
    const d = await fetchJson("/api/ai/providers/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setStatus(d.status);
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const d = await fetchJson("/api/ai/providers/test", { method: "POST" });
      setTestResult(d);
    } catch {
      setTestResult({ ok: false, response: "Bağlantı hatası" });
    }
    setTesting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-[#0d1424] border border-[#1a2744] rounded-xl w-[480px] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[#1a2744]">
          <div className="flex items-center gap-2 text-[#00d4ff]">
            <Settings size={16} />
            <span className="font-bold text-sm tracking-wider">AI PROVIDER SETTINGS</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {status?.active && (
            <div className="flex items-center gap-2 text-xs text-[#00ff88]">
              <div className="w-2 h-2 rounded-full bg-[#00ff88] animate-pulse" />
              Active: {status.active} {status.providers?.find(p => p.active)?.model}
            </div>
          )}

          <div>
            <label className="text-xs text-slate-400 mb-2 block">Select Provider</label>
            <div className="grid grid-cols-5 gap-2">
              {PROVIDERS.map(p => (
                <button
                  key={p.id}
                  onClick={() => { setSelected(p.id); setModel(""); setApiKey(""); setTestResult(null); }}
                  className={`py-2 px-1 rounded text-xs font-medium transition-all ${
                    selected === p.id
                      ? "bg-[#00d4ff]/20 border border-[#00d4ff] text-[#00d4ff]"
                      : "bg-[#0a0e1a] border border-[#1a2744] text-slate-400 hover:border-[#00d4ff]/50"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {selectedInfo && (
            <div>
              <label className="text-xs text-slate-400 mb-2 block">Model</label>
              <select
                value={model}
                onChange={e => setModel(e.target.value)}
                className="w-full bg-[#0a0e1a] border border-[#1a2744] rounded px-3 py-2 text-xs text-slate-300 outline-none focus:border-[#00d4ff]"
              >
                <option value="">-- Default --</option>
                {selectedInfo.models.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          )}

          {selectedInfo?.needsKey && (
            <div>
              <label className="text-xs text-slate-400 mb-2 block">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full bg-[#0a0e1a] border border-[#1a2744] rounded px-3 py-2 text-xs text-slate-300 outline-none focus:border-[#00d4ff] font-mono"
              />
            </div>
          )}

          {selected === "ollama" && (
            <div>
              <label className="text-xs text-slate-400 mb-2 block">Ollama Base URL</label>
              <input
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                className="w-full bg-[#0a0e1a] border border-[#1a2744] rounded px-3 py-2 text-xs text-slate-300 outline-none focus:border-[#00d4ff] font-mono"
              />
              <p className="text-xs text-slate-600 mt-1">Local Ollama adresi (varsayılan: localhost:11434)</p>
            </div>
          )}

          {testResult && (
            <div className={`flex items-center gap-2 text-xs p-2 rounded ${testResult.ok ? "bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/30" : "bg-[#ff3366]/10 text-[#ff3366] border border-[#ff3366]/30"}`}>
              {testResult.ok ? <Check size={12} /> : <X size={12} />}
              {testResult.ok ? testResult.response : "Bağlantı başarısız — API key kontrol et"}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleTest}
              disabled={testing}
              className="flex-1 py-2 text-xs border border-[#1a2744] text-slate-400 hover:border-[#00d4ff] hover:text-[#00d4ff] rounded transition-all flex items-center justify-center gap-2"
            >
              {testing ? <Loader size={12} className="animate-spin" /> : null}
              Test Connection
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2 text-xs bg-[#00d4ff]/10 border border-[#00d4ff] text-[#00d4ff] hover:bg-[#00d4ff]/20 rounded transition-all flex items-center justify-center gap-2"
            >
              {saving ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
              Save & Activate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
