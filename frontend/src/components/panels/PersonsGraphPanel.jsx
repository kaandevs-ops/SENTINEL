import { useEffect, useMemo, useState } from "react";
import { useSentinelStore } from "../../store/useSentinelStore";
import { fetchJson, unwrapData } from "../../lib/apiClient";

const RISK_CLASS = {
  critical: "text-[#ff3366]",
  high: "text-[#ff6633]",
  medium: "text-[#ffaa00]",
  low: "text-[#00ff88]",
};

export default function PersonsGraphPanel() {
  const persons = useSentinelStore((s) => s.persons || []);
  const selectedPersonId = useSentinelStore((s) => s.selectedPersonId);
  const setSelectedPersonId = useSentinelStore((s) => s.setSelectedPersonId);
  const [graph, setGraph] = useState({ nodes: [], edges: [] });

  useEffect(() => {
    let alive = true;
    const loadGraph = async () => {
      try {
        const payload = await fetchJson("/api/persons/graph");
        if (!alive) return;
        setGraph(unwrapData(payload, { nodes: [], edges: [] }));
      } catch {
        // best effort
      }
    };
    loadGraph();
    const id = setInterval(loadGraph, 20000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [persons.length]);

  const strongestLinks = useMemo(() => {
    return [...(graph.edges || [])]
      .sort((a, b) => (b.weight || 0) - (a.weight || 0))
      .slice(0, 8);
  }, [graph.edges]);

  const nodeMap = useMemo(() => {
    const out = {};
    for (const n of graph.nodes || []) out[n.id] = n;
    return out;
  }, [graph.nodes]);

  const onSelect = (id) => {
    setSelectedPersonId(id);
    const p = persons.find((x) => x.id === id);
    if (p && typeof window.__sentinelFlyTo === "function") {
      window.__sentinelFlyTo(Number(p.longitude || 0), Number(p.latitude || 0), 500000);
    }
  };

  return (
    <div className="sentinel-panel p-2 space-y-1">
      <div className="flex items-center justify-between px-1">
        <span className="text-[#00d4ff] text-[10px] font-bold tracking-widest">HUMAN GRAPH</span>
        <span className="text-slate-500 text-[10px]">N:{graph.nodes.length} E:{graph.edges.length}</span>
      </div>
      <div className="max-h-32 overflow-y-auto pr-1">
        {strongestLinks.map((edge) => {
          const a = nodeMap[edge.source];
          const b = nodeMap[edge.target];
          return (
            <div key={`${edge.source}-${edge.target}`} className="text-[10px] py-1 border-b border-[#1a2744]">
              <div className="flex items-center justify-between">
                <button
                  className={`truncate text-left ${(selectedPersonId === edge.source) ? "text-[#22d3ee]" : "text-slate-300"}`}
                  onClick={() => onSelect(edge.source)}
                >
                  {a?.label || edge.source}
                </button>
                <span className="text-slate-500 mx-1">↔</span>
                <button
                  className={`truncate text-right ${(selectedPersonId === edge.target) ? "text-[#22d3ee]" : "text-slate-300"}`}
                  onClick={() => onSelect(edge.target)}
                >
                  {b?.label || edge.target}
                </button>
              </div>
              <div className="text-slate-600">W:{edge.weight} · {(edge.reasons || []).slice(0, 2).join(", ")}</div>
            </div>
          );
        })}
        {strongestLinks.length === 0 && <div className="text-[10px] text-slate-600 px-1 py-1">No graph edges yet.</div>}
      </div>
      {selectedPersonId && nodeMap[selectedPersonId] && (
        <div className="px-1 pt-1 border-t border-[#1a2744] text-[10px]">
          <div className="text-slate-300">{nodeMap[selectedPersonId].label}</div>
          <div className={`${RISK_CLASS[nodeMap[selectedPersonId].risk_level] || "text-slate-500"}`}>
            {(nodeMap[selectedPersonId].risk_level || "low").toUpperCase()} · {nodeMap[selectedPersonId].country || "UNK"}
          </div>
        </div>
      )}
    </div>
  );
}
