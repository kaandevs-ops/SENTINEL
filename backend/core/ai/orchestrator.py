import logging
import json
import re
from datetime import datetime, timezone
from typing import Any, Optional, Sequence

import asyncio

from core.ai.providers import provider_manager

logger = logging.getLogger("sentinel.ai")

SYSTEM_PROMPT = """You are SENTINEL, an elite global intelligence analysis AI similar to Palantir Gotham.
You have access to real-time data: aircraft movements, seismic events, cyber threats, weather alerts, and news.
You analyze patterns, detect anomalies, and provide actionable intelligence assessments.
Be concise, analytical, and use intelligence terminology.
Always respond in the same language the user writes in (Turkish or English).
When asked for JSON, return ONLY valid JSON with no markdown fences."""


def _safe_line(text: Any, *, max_len: int = 140) -> str:
    s = str(text or "")
    s = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) > max_len:
        s = s[: max_len - 1] + "…"
    return s


def _build_context_summary(live: dict, *, ops_events: Sequence[dict] | None = None, alerts: Sequence[dict] | None = None) -> str:
    """Builds a compact live data summary to inject into AI context."""
    aircraft = live.get("aircraft", [])
    earthquakes = live.get("earthquakes", [])
    threats = live.get("threats", [])
    weather = live.get("weather_alerts", [])
    news = live.get("news", [])
    ships = live.get("ships", [])
    wildfires = live.get("wildfires", [])
    cameras = live.get("cameras", [])
    cyber_iocs = live.get("cyber_iocs", [])

    lines = [
        f"=== LIVE INTELLIGENCE FEED ===",
        f"Aircraft: {len(aircraft)} tracked globally",
    ]

    # Top 5 aircraft by country
    if aircraft:
        countries: dict[str, int] = {}
        for a in aircraft:
            c = a.get("country", "Unknown")
            countries[c] = countries.get(c, 0) + 1
        top = sorted(countries.items(), key=lambda x: x[1], reverse=True)[:5]
        lines.append(f"  Top countries: {', '.join(f'{c}({n})' for c,n in top)}")

    lines.append(f"Ships: {len(ships)} tracked")

    # Earthquakes
    lines.append(f"Seismic: {len(earthquakes)} recent events")
    for eq in earthquakes[:3]:
        mag = eq.get("magnitude", "?")
        place = eq.get("place", eq.get("title", "Unknown"))
        lines.append(f"  M{mag} - {_safe_line(place, max_len=90)}")

    # Cyber threats
    lines.append(f"Cyber Threats: {len(threats)} active")
    for t in threats[:3]:
        lines.append(
            f"  {_safe_line(t.get('ip','?'), max_len=48)} - {_safe_line(t.get('malware','?'), max_len=48)} ({_safe_line(t.get('country','?'), max_len=32)})"
        )

    # Weather
    lines.append(f"Weather Alerts: {len(weather)} active")
    for w in weather[:2]:
        lines.append(f"  {_safe_line(w.get('event','?'), max_len=60)} - {_safe_line(w.get('area','?'), max_len=80)}")

    # News
    lines.append(f"News: {len(news)} recent items")
    for n in news[:2]:
        lines.append(f"  {_safe_line(n.get('title','?'), max_len=90)}")

    # Wildfires
    lines.append(f"Wildfires: {len(wildfires)} active markers")
    for w in wildfires[:2]:
        lines.append(f"  {_safe_line(w.get('title','?'), max_len=90)}")

    # Cameras
    lines.append(f"Cameras: {len(cameras)} points")
    lines.append(f"Cyber IOC URLs: {len(cyber_iocs)}")
    for ioc in cyber_iocs[:2]:
        lines.append(f"  {_safe_line(ioc.get('host') or ioc.get('url') or '?', max_len=90)}")

    # Ops & Alerts snapshots (best-effort)
    if ops_events:
        lines.append(f"Ops Events (latest): {min(len(ops_events), 5)} shown")
        for ev in list(ops_events)[:5]:
            lines.append(
                f"  {ev.get('ts','')[:19]} {ev.get('feed','?')} {ev.get('status','?')} sev={ev.get('severity','?')}"
            )
    if alerts:
        lines.append(f"Active Alerts: {len(alerts)}")
        for a in list(alerts)[:3]:
            lines.append(f"  [{a.get('threat_level','?')}] {_safe_line(a.get('title','?'), max_len=90)}")

    lines.append("=== END LIVE FEED ===")
    return "\n".join(lines)


class AIOrchestrator:
    def __init__(self, *, cache: Any = None, alert_service: Any = None, ops_service: Any = None) -> None:
        self._running = False
        self._cache = cache
        self._alert_service = alert_service
        self._ops_service = ops_service
        self._watch_task = None
        self._emitted: set[str] = set()

    async def start(self) -> None:
        self._running = True
        p = provider_manager.get_active()
        if p:
            logger.info(f"🤖 AI Orchestrator started with provider: {p.name}")
        else:
            logger.warning("⚠️  No AI provider configured — AI disabled")
        if self._alert_service and self._cache and (self._watch_task is None or self._watch_task.done()):
            self._watch_task = asyncio.create_task(self._watch_and_alert(), name="ai:watch")

    async def stop(self) -> None:
        self._running = False
        if self._watch_task and not self._watch_task.done():
            self._watch_task.cancel()
            await asyncio.gather(self._watch_task, return_exceptions=True)
        self._watch_task = None

    async def natural_language_query(self, query: str, *, live: Optional[dict] = None) -> str:
        if not provider_manager.get_active():
            return "⚠️ AI provider yapılandırılmamış. Settings'ten API key girin."

        # Pull live context if not provided
        if not isinstance(live, dict):
            try:
                live = await self._cache.get_all_live() if self._cache else None
            except Exception:
                live = None

        ops_events = None
        if self._ops_service:
            try:
                ops_events = self._ops_service.get_events(10)
            except Exception:
                ops_events = None

        alerts = None
        if self._alert_service:
            try:
                alerts = await self._alert_service.get_active_alerts()
            except Exception:
                alerts = None

        context = _build_context_summary(live, ops_events=ops_events, alerts=alerts) if isinstance(live, dict) else "Live data unavailable."

        tool_hint = (
            "\n\nYou may optionally request ONE tool call by returning ONLY valid JSON in one of these forms:\n"
            "A) {\"tool\":\"suggest_layers_to_enable\",\"args\":{\"query\":\"...\"}}\n"
            "B) {\"tool\":\"summarize_feed\",\"args\":{\"feed\":\"news|threats|earthquakes|weather_alerts|wildfires|cameras|cyber_iocs\"}}\n"
            "C) {\"tool\":\"fetch_ops_history\",\"args\":{\"limit\":20}}\n"
            "D) {\"tool\":\"get_live_entity\",\"args\":{\"entity_type\":\"aircraft|ships|threats|persons|cameras\",\"id\":\"...\"}}\n"
            "E) {\"tool\":\"create_alert\",\"args\":{\"title\":\"...\",\"description\":\"...\",\"threat_level\":\"low|medium|high|critical\"}}\n"
            "If you do not need a tool, respond normally (not JSON).\n"
        )

        full_prompt = f"{context}{tool_hint}\nUser query: {query}"

        result = await provider_manager.complete(SYSTEM_PROMPT, full_prompt)
        if not result:
            return "AI analizi şu an kullanılamıyor."

        final = await self._maybe_tool_loop(result, query=query, live=live, base_context=context)
        return final or result

    async def _maybe_tool_loop(self, model_text: str, *, query: str, live: Optional[dict], base_context: str) -> Optional[str]:
        """
        Provider-agnostic minimal tool loop:
        - If model replies with a JSON tool request, execute it (allowlist), then ask model again with tool result.
        - Max 2 iterations. If parsing fails, return None to fall back to original model_text.
        """
        txt = (model_text or "").strip()
        tool_req = self._parse_tool_request(txt)
        if not tool_req:
            return None

        tool_name = tool_req.get("tool")
        args = tool_req.get("args") or {}
        tool_result = await self._execute_tool(tool_name, args=args, live=live, query=query)
        if tool_result is None:
            return None

        tool_context = (
            f"{base_context}\n\n=== TOOL RESULT ({tool_name}) ===\n"
            f"{tool_result}\n=== END TOOL RESULT ===\n"
        )
        followup_prompt = f"{tool_context}\nUser query: {query}\n\nProvide the final answer (not JSON)."
        out = await provider_manager.complete(SYSTEM_PROMPT, followup_prompt)
        return out

    def _parse_tool_request(self, text: str) -> Optional[dict]:
        # Strip markdown fences if present
        m = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
        if m:
            text = m.group(1)
        try:
            obj = json.loads(text)
        except Exception:
            return None
        if not isinstance(obj, dict):
            return None
        if "tool" not in obj:
            return None
        return obj

    async def _execute_tool(self, tool: str, *, args: dict, live: Optional[dict], query: str) -> Optional[str]:
        allow = {
            "suggest_layers_to_enable",
            "summarize_feed",
            "fetch_ops_history",
            "get_live_entity",
            "create_alert",
        }
        if tool not in allow:
            return None

        # Ensure live exists if needed
        if not isinstance(live, dict):
            try:
                live = await self._cache.get_all_live() if self._cache else {}
            except Exception:
                live = {}

        if tool == "suggest_layers_to_enable":
            q = str((args or {}).get("query") or query or "").lower()
            suggested = []
            # Simple keyword routing (fast + deterministic)
            if any(k in q for k in ["uçak", "flight", "aircraft", "adsb", "plane"]):
                suggested.append("aircraft")
            if any(k in q for k in ["gemi", "ship", "ais", "maritime"]):
                suggested.append("ships")
            if any(k in q for k in ["deprem", "earthquake", "seismic"]):
                suggested.append("earthquakes")
            if any(k in q for k in ["hava", "weather", "storm", "radar"]):
                suggested.append("weatherAlerts")
                suggested.append("radarOverlay")
            if any(k in q for k in ["haber", "news", "osint"]):
                suggested.append("news")
            if any(k in q for k in ["siber", "threat", "malware", "ioc"]):
                suggested.append("threats")
                suggested.append("cyberIocs")
            if any(k in q for k in ["yangın", "fire", "wildfire"]):
                suggested.append("wildfires")
            if any(k in q for k in ["kamera", "cctv", "mobese", "cam"]):
                suggested.append("cameras")
            suggested = list(dict.fromkeys(suggested))[:8]
            return json.dumps({"suggested_layers": suggested}, ensure_ascii=False)

        if tool == "summarize_feed":
            feed = str((args or {}).get("feed") or "").strip()
            allowed = {"news", "threats", "earthquakes", "weather_alerts", "wildfires", "cameras", "cyber_iocs"}
            if feed not in allowed:
                return json.dumps({"error": "invalid_feed"}, ensure_ascii=False)
            rows = live.get(feed) or []
            sample = rows[:8] if isinstance(rows, list) else []
            return json.dumps(
                {
                    "feed": feed,
                    "count": len(rows) if isinstance(rows, list) else 0,
                    "sample": sample,
                },
                ensure_ascii=False,
                default=str,
            )

        if tool == "fetch_ops_history":
            limit = int((args or {}).get("limit") or 20)
            limit = max(1, min(limit, 80))
            if not self._ops_service:
                return json.dumps({"error": "ops_service_unavailable"}, ensure_ascii=False)
            return json.dumps({"ops_events": self._ops_service.get_events(limit)}, ensure_ascii=False, default=str)

        if tool == "get_live_entity":
            et = str((args or {}).get("entity_type") or "").strip()
            ent_id = str((args or {}).get("id") or "").strip()
            if not ent_id or et not in {"aircraft", "ships", "threats", "persons", "cameras"}:
                return json.dumps({"error": "invalid_args"}, ensure_ascii=False)
            rows = live.get(et) or []
            if not isinstance(rows, list):
                rows = []
            hits = []
            for r in rows:
                if not isinstance(r, dict):
                    continue
                if str(r.get("id") or "") == ent_id:
                    hits.append(r)
                    continue
                if et == "aircraft" and str(r.get("callsign") or "").strip() == ent_id:
                    hits.append(r)
                if et == "threats" and str(r.get("ip") or "").strip() == ent_id:
                    hits.append(r)
            return json.dumps({"entity_type": et, "id": ent_id, "matches": hits[:5]}, ensure_ascii=False, default=str)

        if tool == "create_alert":
            if not self._alert_service:
                return json.dumps({"error": "alert_service_unavailable"}, ensure_ascii=False)
            title = _safe_line((args or {}).get("title") or "AI Alert", max_len=90)
            desc = _safe_line((args or {}).get("description") or "", max_len=260)
            lvl = str((args or {}).get("threat_level") or "medium").lower()
            if lvl not in {"low", "medium", "high", "critical"}:
                lvl = "medium"
            await self._alert_service.create_ai_alert(title=title, description=desc, threat_level=lvl)
            return json.dumps({"ok": True, "created": True, "threat_level": lvl}, ensure_ascii=False)

        return None

    async def generate_intelligence_report(self, region: str = "global", *, live: Optional[dict] = None) -> dict:
        if not provider_manager.get_active():
            return {"error": "No AI provider configured"}

        context = _build_context_summary(live) if isinstance(live, dict) else ""

        prompt = (
            f"{context}\n\n"
            f"Generate a brief intelligence report for region: {region}.\n"
            f'Return ONLY valid JSON: {{"title":"","summary":"","threat_level":"low|medium|high|critical","key_findings":[],"recommendations":[]}}'
        )
        result = await self._ask_json(prompt)
        return result or {"error": "Analysis failed"}

    async def analyze_entity(self, entity_id: str, entity_type: str, context: list) -> dict:
        if not provider_manager.get_active():
            return {"error": "No AI provider configured"}

        prompt = (
            f"Analyze {entity_type} entity: {entity_id}\n"
            f"Context data: {json.dumps(context[:5])}\n"
            f'Return ONLY valid JSON: {{"assessment":"","risk_level":"low|medium|high|critical","anomalies":[],"recommendations":[]}}'
        )
        return await self._ask_json(prompt) or {"error": "Analysis failed"}

    async def generate_copilot_plan(
        self,
        objective: str,
        *,
        live: Optional[dict] = None,
        ops_events: Optional[Sequence[dict]] = None,
        alerts: Optional[Sequence[dict]] = None,
    ) -> dict:
        if not provider_manager.get_active():
            return {"error": "No AI provider configured"}

        if not isinstance(live, dict):
            try:
                live = await self._cache.get_all_live() if self._cache else {}
            except Exception:
                live = {}

        if ops_events is None and self._ops_service:
            try:
                ops_events = self._ops_service.get_events(25)
            except Exception:
                ops_events = []
        if alerts is None and self._alert_service:
            try:
                alerts = await self._alert_service.get_active_alerts()
            except Exception:
                alerts = []

        context = _build_context_summary(live, ops_events=ops_events or [], alerts=alerts or [])
        prompt = (
            f"{context}\n\n"
            f"Objective: {objective}\n"
            "Create an operational copilot plan for the analyst.\n"
            "Return ONLY valid JSON with this schema:\n"
            '{"mission_summary":"","priority":"low|medium|high|critical","recommended_layers":[],"actions":[{"title":"","why":"","eta_min":0}],"watchouts":[],"next_questions":[]}'
        )
        result = await self._ask_json(prompt)
        if not isinstance(result, dict):
            return {"error": "copilot_plan_failed"}
        return result

    async def _ask_json(self, prompt: str) -> Optional[Any]:
        text = await provider_manager.complete(SYSTEM_PROMPT, prompt)
        if not text:
            return None
        # Strip markdown fences if present
        match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
        if match:
            text = match.group(1)
        try:
            return json.loads(text)
        except Exception:
            return None

    def status(self) -> dict:
        return provider_manager.status()

    async def _watch_and_alert(self) -> None:
        """
        Periodic AI triage: watches for high-signal events and emits alerts.
        Kept conservative and idempotent (dedupe) to avoid spam.
        """
        import asyncio

        while self._running:
            try:
                if not provider_manager.get_active():
                    await asyncio.sleep(30)
                    continue
                if not self._cache or not self._alert_service:
                    await asyncio.sleep(60)
                    continue

                live = await self._cache.get_all_live()

                # Earthquake triggers
                for eq in (live.get("earthquakes") or [])[:30]:
                    try:
                        mag = float(eq.get("magnitude") or 0)
                    except Exception:
                        mag = 0.0
                    if mag < 6.0:
                        continue
                    eq_id = eq.get("id") or f"eq:{eq.get('time','')}"
                    key = f"eq:{eq_id}"
                    if key in self._emitted:
                        continue
                    self._emitted.add(key)
                    title = f"High magnitude earthquake detected (M{mag:.1f})"
                    desc = _safe_line(eq.get("place") or eq.get("title") or "Unknown", max_len=220)
                    await self._alert_service.create_ai_alert(
                        title=title,
                        description=desc,
                        threat_level="high" if mag < 7.0 else "critical",
                        latitude=eq.get("latitude"),
                        longitude=eq.get("longitude"),
                    )

                # Wildfire triggers (cluster size)
                wf = live.get("wildfires") or []
                if len(wf) >= 120:
                    key = f"wf:cluster:{datetime.now(timezone.utc).strftime('%Y%m%d%H')}"
                    if key not in self._emitted:
                        self._emitted.add(key)
                        await self._alert_service.create_ai_alert(
                            title="Wildfire activity spike detected",
                            description=f"Active wildfire markers: {len(wf)} (EONET). Consider enabling Wildfires layer and reviewing hotspots.",
                            threat_level="medium",
                        )

                # Cyber threat volume
                th = live.get("threats") or []
                if len(th) >= 180:
                    key = f"th:volume:{datetime.now(timezone.utc).strftime('%Y%m%d%H')}"
                    if key not in self._emitted:
                        self._emitted.add(key)
                        await self._alert_service.create_ai_alert(
                            title="Cyber threat feed volume elevated",
                            description=f"Threat indicators: {len(th)}. Consider enabling Threats layer and prioritizing top malware families.",
                            threat_level="medium",
                        )

                # Keep dedupe set bounded
                if len(self._emitted) > 2000:
                    self._emitted = set(list(self._emitted)[-1200:])
            except asyncio.CancelledError:
                return
            except Exception as e:
                logger.warning(f"AI watch loop error: {e}")

            await asyncio.sleep(180)


ai_orchestrator = AIOrchestrator()
