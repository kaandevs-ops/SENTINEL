import { useEffect, useRef, useCallback } from "react";
import { useSentinelStore } from "../store/useSentinelStore";
import { fetchJson, unwrapList } from "../lib/apiClient";

export function useWebSocket() {
  const ws = useRef(null);
  const connectRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  const { setLiveData, addAlert, setWsStatus, updateStats, setFeedHealth, setFeedTimeline, addFeedTimelineEvent } = useSentinelStore();

  const refreshOpsHistory = useCallback(async () => {
    try {
      const payload = await fetchJson("/api/intelligence/ops/events/history?limit=80");
      const rows = unwrapList(payload);
      if (rows.length > 0) {
        setFeedTimeline(rows);
      }
    } catch {
      // best-effort
    }
  }, [setFeedTimeline]);

  const refreshHealth = useCallback(async () => {
    try {
      const res = await fetch("/health");
      if (!res.ok) return;
      const health = await res.json();
      const collectors = health?.collectors || {};
      const nowIso = new Date().toISOString();
      const mapping = {
        aircraft: "aircraft",
        ships: "ships",
        satellites: "satellites",
        earthquakes: "earthquakes",
        weather: "weather",
        news: "news",
        threats: "threats",
        wildfires: "wildfires",
        cameras: "cameras",
        conflicts: "conflicts",
        cyber_iocs: "cyber_iocs",
      };

      Object.entries(mapping).forEach(([collectorKey, feedKey]) => {
        const c = collectors[collectorKey];
        if (!c) return;
        const lastFetch = c.last_fetch || null;
        const lastError = c.last_error || null;
        const confidence = typeof c.confidence === "number" ? c.confidence : null;
        const source = c.source || null;
        const ageSec = lastFetch ? Math.floor((Date.now() - new Date(lastFetch).getTime()) / 1000) : null;
        const stale = ageSec == null ? true : ageSec > 180;
        const degraded = lastError === "rate_limited" || (!!lastError && !stale);
        const status = stale ? "stale" : degraded ? "degraded" : "healthy";

        setFeedHealth(feedKey, {
          status,
          lastFetch,
          lastError,
          confidence,
          source,
          updatedAt: nowIso,
        });
      });
    } catch {
      // Silent fail: websocket/live stream is primary source.
    }
  }, [setFeedHealth]);

  const scheduleReconnect = useCallback(() => {
    if (!shouldReconnectRef.current) return;
    reconnectAttemptRef.current += 1;
    const attempt = reconnectAttemptRef.current;
    const baseDelay = Math.min(30000, 1000 * (2 ** Math.min(attempt, 6)));
    const jitter = Math.floor(Math.random() * 700);
    const delayMs = baseDelay + jitter;
    setWsStatus("reconnecting");
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = setTimeout(() => {
      if (shouldReconnectRef.current) connectRef.current?.();
    }, delayMs);
  }, [setWsStatus]);

  const connect = useCallback(() => {
    try {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        reconnectAttemptRef.current = 0;
        setWsStatus("connected");
        console.log("🛡️ SENTINEL WebSocket connected");
        refreshHealth();
      };

      ws.current.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "initial_state") {
          const d = msg.data;
          if (d.aircraft)       setLiveData("aircraft", d.aircraft);
          if (d.ships)          setLiveData("ships", d.ships);
          if (d.satellites)     setLiveData("satellites", d.satellites);
          if (d.persons)        setLiveData("persons", d.persons);
          if (d.earthquakes)    setLiveData("earthquakes", d.earthquakes);
          if (d.weather_alerts) setLiveData("weatherAlerts", d.weather_alerts);
          if (d.news)           setLiveData("news", d.news);
          if (d.threats)        setLiveData("threats", d.threats);
          if (d.wildfires)      setLiveData("wildfires", d.wildfires);
          if (d.cameras)        setLiveData("cameras", d.cameras);
          if (d.conflicts)      setLiveData("conflicts", d.conflicts);
          if (d.cyber_iocs)     setLiveData("cyberIocs", d.cyber_iocs);
          if (d.gps_jamming)    setLiveData("gpsJamming", d.gps_jamming);
          updateStats();
        } else if (msg.type === "ops_snapshot") {
          setFeedTimeline(msg.events || []);
        } else if (msg.type === "ops_event" && msg.event) {
          addFeedTimelineEvent(msg.event);
        } else if (msg.type === "aircraft_update")  { setLiveData("aircraft", msg.data);   updateStats(); }
        else if (msg.type === "ship_update")        { setLiveData("ships", msg.data);       updateStats(); }
        else if (msg.type === "satellite_update")   { setLiveData("satellites", msg.data);  updateStats(); }
        else if (msg.type === "earthquake_update")  { setLiveData("earthquakes", msg.data); updateStats(); }
        else if (msg.type === "weather_update")     { setLiveData("weatherAlerts", msg.data); }
        else if (msg.type === "news_update")        { setLiveData("news", msg.data); }
        else if (msg.type === "threat_update")      { setLiveData("threats", msg.data);     updateStats(); }
        else if (msg.type === "wildfires_update")   { setLiveData("wildfires", msg.data); }
        else if (msg.type === "cameras_update")     { setLiveData("cameras", msg.data); }
        else if (msg.type === "conflicts_update")   { setLiveData("conflicts", msg.data); }
        else if (msg.type === "cyber_iocs_update")  { setLiveData("cyberIocs", msg.data); }
        else if (msg.type === "person_update")      { setLiveData("persons", msg.data); }
        else if (msg.type === "gps_jamming_update") { setLiveData("gpsJamming", msg.data); }
        else if (msg.type === "new_alert")          { addAlert(msg.alert); }
        else if (msg.type === "nl_response") {
          window.dispatchEvent(new CustomEvent("sentinel-ai-response", { detail: msg.answer }));
        }
      };

      ws.current.onclose = () => {
        setWsStatus("disconnected");
        scheduleReconnect();
      };
      ws.current.onerror = () => {
        setWsStatus("error");
        try {
          ws.current?.close();
        } catch {
          // no-op
        }
      };
    } catch (e) {
      console.error("WS error:", e);
      scheduleReconnect();
    }
  }, [
    addAlert,
    addFeedTimelineEvent,
    refreshHealth,
    scheduleReconnect,
    setFeedTimeline,
    setLiveData,
    setWsStatus,
    updateStats,
  ]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const sendQuery = useCallback((query) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: "nl_query", query }));
    }
  }, []);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();
    refreshHealth();
    refreshOpsHistory();
    const id = setInterval(refreshHealth, 15000);
    return () => {
      shouldReconnectRef.current = false;
      clearInterval(id);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      ws.current?.close();
    };
  }, [connect, refreshHealth, refreshOpsHistory]);

  return { sendQuery };
}
