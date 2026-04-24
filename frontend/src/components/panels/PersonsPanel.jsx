import { useEffect, useMemo, useState } from "react";
import { useSentinelStore } from "../../store/useSentinelStore";
import { fetchJson, unwrapData } from "../../lib/apiClient";

const RISK_CLASS = {
  critical: "text-[#ff3366]",
  high: "text-[#ff6633]",
  medium: "text-[#ffaa00]",
  low: "text-[#00ff88]",
};

export default function PersonsPanel() {
  const persons = useSentinelStore((s) => s.persons || []);
  const selectedPersonId = useSentinelStore((s) => s.selectedPersonId);
  const setSelectedPersonId = useSentinelStore((s) => s.setSelectedPersonId);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [networkStats, setNetworkStats] = useState({ edges: 0, topCountry: "-" });
  const [form, setForm] = useState({
    id: "",
    full_name: "",
    role: "analyst",
    status: "active",
    risk_level: "low",
    country: "TR",
    city: "",
    latitude: "",
    longitude: "",
    email: "",
  });

  const overview = useMemo(() => {
    const byStatus = {};
    for (const p of persons) {
      const k = (p.status || "unknown").toLowerCase();
      byStatus[k] = (byStatus[k] || 0) + 1;
    }
    return byStatus;
  }, [persons]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return persons.filter((p) => {
      if (statusFilter !== "all" && (p.status || "").toLowerCase() !== statusFilter) return false;
      if (riskFilter !== "all" && (p.risk_level || "").toLowerCase() !== riskFilter) return false;
      if (!q) return true;
      const text = [p.id, p.full_name, p.nickname, p.role, p.city, p.country].join(" ").toLowerCase();
      return text.includes(q);
    });
  }, [persons, query, statusFilter, riskFilter]);

  const summaryRisk = useMemo(() => {
    const out = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const p of persons) {
      const key = (p.risk_level || "low").toLowerCase();
      if (key in out) out[key] += 1;
    }
    return out;
  }, [persons]);

  useEffect(() => {
    let alive = true;
    const loadSummary = async () => {
      try {
        const [summaryPayload, graphPayload] = await Promise.all([
          fetchJson("/api/persons/summary"),
          fetchJson("/api/persons/graph"),
        ]);
        if (!alive) return;
        const summary = unwrapData(summaryPayload, {});
        const graph = unwrapData(graphPayload, {});
        const topCountry = summary?.top_countries?.[0]?.country || "-";
        const edges = graph?.edges?.length || 0;
        setNetworkStats({ edges, topCountry });
      } catch {
        // best effort only
      }
    };
    loadSummary();
    const id = setInterval(loadSummary, 20000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [persons.length]);

  const onPick = (person) => {
    setSelectedPersonId(person.id);
    setForm({
      id: person.id || "",
      full_name: person.full_name || "",
      role: person.role || "analyst",
      status: person.status || "active",
      risk_level: person.risk_level || "low",
      country: person.country || "TR",
      city: person.city || "",
      latitude: String(person.latitude ?? ""),
      longitude: String(person.longitude ?? ""),
      email: person.email || "",
    });
    if (typeof window.__sentinelFlyTo === "function") {
      window.__sentinelFlyTo(Number(person.longitude || 0), Number(person.latitude || 0), 500000);
    }
  };

  const resetForm = () => {
    setSelectedPersonId(null);
    setError("");
    setForm({
      id: "",
      full_name: "",
      role: "analyst",
      status: "active",
      risk_level: "low",
      country: "TR",
      city: "",
      latitude: "",
      longitude: "",
      email: "",
    });
  };

  const savePerson = async () => {
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        nickname: "",
        phone: "",
        skills: [],
        notes: "",
      };
      if (!payload.id || !payload.full_name) throw new Error("ID and full name are required");
      if (Number.isNaN(payload.latitude) || Number.isNaN(payload.longitude)) throw new Error("Latitude/Longitude invalid");

      const effectiveId = selectedPersonId;
      const endpoint = effectiveId ? `/api/persons/${effectiveId}` : "/api/persons/";
      const method = effectiveId ? "PUT" : "POST";
      const body = await fetchJson(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (body?.ok === false) throw new Error(body?.error?.message || "Save failed");
      resetForm();
    } catch (e) {
      setError(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async () => {
    if (!selectedPersonId) return;
    setSaving(true);
    setError("");
    try {
      const body = await fetchJson(`/api/persons/${selectedPersonId}`, { method: "DELETE" });
      if (body?.ok === false) throw new Error(body?.error?.message || "Delete failed");
      resetForm();
    } catch (e) {
      setError(e.message || "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sentinel-panel p-2 space-y-1">
      <div className="flex items-center justify-between px-1">
        <span className="text-[#00d4ff] text-[10px] font-bold tracking-widest">HUMAN ASSETS</span>
        <span className="text-[#22d3ee] text-[10px] font-mono">{persons.length}</span>
      </div>
      <div className="px-2 text-[10px] text-slate-500">
        Active: {overview.active || 0} · Standby: {overview.standby || 0}
      </div>
      <div className="px-2 text-[10px] text-slate-500">
        CRIT:{summaryRisk.critical} HIGH:{summaryRisk.high} MED:{summaryRisk.medium} LOW:{summaryRisk.low}
      </div>
      <div className="px-2 text-[10px] text-slate-500">
        LINKS:{networkStats.edges} TOP:{networkStats.topCountry}
      </div>

      <div className="grid grid-cols-3 gap-1 px-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search"
          className="col-span-3 bg-[#0a0e1a] border border-[#1a2744] rounded text-[10px] text-slate-300 px-1.5 py-1"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-[#0a0e1a] border border-[#1a2744] rounded text-[10px] text-slate-400 px-1 py-1"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="standby">Standby</option>
          <option value="offline">Offline</option>
        </select>
        <select
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value)}
          className="bg-[#0a0e1a] border border-[#1a2744] rounded text-[10px] text-slate-400 px-1 py-1"
        >
          <option value="all">All Risk</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <button onClick={resetForm} className="border border-[#1a2744] rounded text-[10px] text-slate-400 hover:text-slate-200">New</button>
      </div>

      <div className="max-h-32 overflow-y-auto pr-1">
        {filtered.slice(0, 12).map((p) => (
          <button
            key={p.id}
            onClick={() => onPick(p)}
            className={`w-full text-left text-[10px] py-1 px-1 border-b border-[#1a2744] ${selectedPersonId === p.id ? "bg-[#00d4ff]/10" : ""}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-slate-300 truncate mr-2">{p.full_name}</span>
              <span className={`font-mono ${RISK_CLASS[(p.risk_level || "low").toLowerCase()] || "text-slate-500"}`}>
                {(p.risk_level || "low").toUpperCase()}
              </span>
            </div>
            <div className="text-slate-600 truncate">{p.role} · {p.city}, {p.country}</div>
          </button>
        ))}
        {filtered.length === 0 && <div className="text-[10px] text-slate-600 px-2 py-1">No matching assets.</div>}
      </div>

      <div className="grid grid-cols-2 gap-1 px-1 pt-1 border-t border-[#1a2744]">
        <input value={form.id} onChange={(e) => setForm((s) => ({ ...s, id: e.target.value }))} placeholder="ID"
          className="bg-[#0a0e1a] border border-[#1a2744] rounded text-[10px] text-slate-300 px-1.5 py-1" />
        <input value={form.full_name} onChange={(e) => setForm((s) => ({ ...s, full_name: e.target.value }))} placeholder="Full Name"
          className="bg-[#0a0e1a] border border-[#1a2744] rounded text-[10px] text-slate-300 px-1.5 py-1" />
        <input value={form.role} onChange={(e) => setForm((s) => ({ ...s, role: e.target.value }))} placeholder="Role"
          className="bg-[#0a0e1a] border border-[#1a2744] rounded text-[10px] text-slate-300 px-1.5 py-1" />
        <input value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} placeholder="Email"
          className="bg-[#0a0e1a] border border-[#1a2744] rounded text-[10px] text-slate-300 px-1.5 py-1" />
        <input value={form.city} onChange={(e) => setForm((s) => ({ ...s, city: e.target.value }))} placeholder="City"
          className="bg-[#0a0e1a] border border-[#1a2744] rounded text-[10px] text-slate-300 px-1.5 py-1" />
        <input value={form.country} onChange={(e) => setForm((s) => ({ ...s, country: e.target.value.toUpperCase() }))} placeholder="Country"
          className="bg-[#0a0e1a] border border-[#1a2744] rounded text-[10px] text-slate-300 px-1.5 py-1" />
        <input value={form.latitude} onChange={(e) => setForm((s) => ({ ...s, latitude: e.target.value }))} placeholder="Latitude"
          className="bg-[#0a0e1a] border border-[#1a2744] rounded text-[10px] text-slate-300 px-1.5 py-1" />
        <input value={form.longitude} onChange={(e) => setForm((s) => ({ ...s, longitude: e.target.value }))} placeholder="Longitude"
          className="bg-[#0a0e1a] border border-[#1a2744] rounded text-[10px] text-slate-300 px-1.5 py-1" />
        <select value={form.status} onChange={(e) => setForm((s) => ({ ...s, status: e.target.value }))}
          className="bg-[#0a0e1a] border border-[#1a2744] rounded text-[10px] text-slate-400 px-1 py-1">
          <option value="active">active</option>
          <option value="standby">standby</option>
          <option value="offline">offline</option>
        </select>
        <select value={form.risk_level} onChange={(e) => setForm((s) => ({ ...s, risk_level: e.target.value }))}
          className="bg-[#0a0e1a] border border-[#1a2744] rounded text-[10px] text-slate-400 px-1 py-1">
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
          <option value="critical">critical</option>
        </select>
      </div>
      <div className="px-1 flex items-center gap-1">
        <button
          onClick={savePerson}
          disabled={saving}
          className="flex-1 border border-[#00d4ff]/40 bg-[#00d4ff]/10 text-[#00d4ff] rounded text-[10px] py-1 disabled:opacity-50"
        >
          {selectedPersonId ? "Update Asset" : "Add Asset"}
        </button>
        <button
          onClick={deleteSelected}
          disabled={!selectedPersonId || saving}
          className="flex-1 border border-[#ff3366]/40 bg-[#ff3366]/10 text-[#ff3366] rounded text-[10px] py-1 disabled:opacity-40"
        >
          Delete
        </button>
      </div>
      {error && <div className="px-2 text-[10px] text-[#ff6633]">{error}</div>}
    </div>
  );
}
