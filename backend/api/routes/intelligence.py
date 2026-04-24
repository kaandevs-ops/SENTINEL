import asyncio
from fastapi import APIRouter, Depends, HTTPException, Query

from api.deps import get_ai_orchestrator, get_cache, get_ops_service, get_alert_service
from api.response import list_ok, ok
from core.ai.orchestrator import AIOrchestrator
from services.operational_event_service import OperationalEventService
from services.cache_service import CacheService
from services.alert_service import AlertService

router = APIRouter()

AI_TIMEOUT = 60  # seconds


def _bucket_hotspots(live: dict) -> list[dict]:
    scores: dict[str, float] = {}
    details: dict[str, dict] = {}

    def bump(region: str, weight: float, kind: str) -> None:
        if not region:
            return
        scores[region] = scores.get(region, 0.0) + weight
        slot = details.setdefault(region, {"earthquakes": 0, "weather": 0, "threats": 0, "aircraft": 0, "ships": 0})
        slot[kind] = slot.get(kind, 0) + 1

    for eq in live.get("earthquakes", []):
        region = (eq.get("place") or "Unknown").split(",")[-1].strip()[:40]
        mag = float(eq.get("magnitude") or 0)
        bump(region or "Unknown", min(max(mag / 2.5, 0.4), 3.0), "earthquakes")

    for w in live.get("weather_alerts", []):
        region = (w.get("area") or "Unknown").split(",")[0].strip()[:40]
        sev = (w.get("severity") or "").lower()
        weight = 1.2 if sev == "extreme" else 0.9 if sev == "severe" else 0.6
        bump(region or "Unknown", weight, "weather")

    for t in live.get("threats", []):
        region = (t.get("country") or "Unknown").strip()[:40]
        bump(region, 0.8, "threats")

    for a in live.get("aircraft", []):
        region = (a.get("country") or "Unknown").strip()[:40]
        bump(region, 0.02, "aircraft")

    for s in live.get("ships", []):
        region = (s.get("flag") or "Unknown").strip()[:40]
        bump(region, 0.04, "ships")

    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:8]
    result = []
    for region, score in ranked:
        level = "low"
        if score >= 7:
            level = "critical"
        elif score >= 4:
            level = "high"
        elif score >= 2:
            level = "medium"
        result.append(
            {
                "region": region,
                "score": round(score, 2),
                "threat_level": level,
                "signals": details.get(region, {}),
            }
        )
    return result


@router.get("/report")
async def get_intelligence_report(
    region: str = Query("global"),
    cache: CacheService = Depends(get_cache),
    ai_orchestrator: AIOrchestrator = Depends(get_ai_orchestrator),
):
    try:
        live = await cache.get_all_live()
        result = await asyncio.wait_for(
            ai_orchestrator.generate_intelligence_report(region, live=live),
            timeout=AI_TIMEOUT,
        )
        return ok(data=result)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="AI analysis timed out")


@router.get("/analyze/{entity_id}")
async def analyze_entity(
    entity_id: str,
    entity_type: str = Query("aircraft"),
    cache: CacheService = Depends(get_cache),
    ai_orchestrator: AIOrchestrator = Depends(get_ai_orchestrator),
):
    # Pull live context for the entity
    data = await cache.get(f"live:{entity_type}s") or []
    context = [e for e in data if e.get("id") == entity_id or e.get("callsign") == entity_id]
    try:
        result = await asyncio.wait_for(
            ai_orchestrator.analyze_entity(entity_id, entity_type, context),
            timeout=AI_TIMEOUT,
        )
        return ok(data=result)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="AI analysis timed out")


@router.get("/situation")
async def get_situation_report(cache: CacheService = Depends(get_cache)):
    """Quick global situation assessment using live data — no AI needed."""
    aircraft = await cache.get("live:aircraft") or []
    eq = await cache.get("live:earthquakes") or []
    threats = await cache.get("live:threats") or []
    weather = await cache.get("live:weather_alerts") or []

    threat_score = 0.0
    if eq:
        threat_score += min(max(e.get("magnitude", 0) for e in eq) / 9.0, 0.4)
    extreme_wx = [w for w in weather if w.get("severity") in ("Extreme", "Severe")]
    if extreme_wx:
        threat_score += min(len(extreme_wx) * 0.05, 0.3)
    if threats:
        threat_score += min(len(threats) * 0.001, 0.3)

    level = "low"
    if threat_score > 0.6:
        level = "critical"
    elif threat_score > 0.4:
        level = "high"
    elif threat_score > 0.2:
        level = "medium"

    payload = {
        "threat_level": level,
        "threat_score": round(threat_score, 3),
        "active_aircraft": len(aircraft),
        "seismic_events": len(eq),
        "cyber_threats": len(threats),
        "weather_alerts": len(weather),
        "extreme_weather": len(extreme_wx),
    }
    return ok(data=payload)


@router.get("/overview")
async def get_operational_overview(cache: CacheService = Depends(get_cache)):
    live = await cache.get_all_live()
    hotspots = _bucket_hotspots(live)
    top_level = hotspots[0]["threat_level"] if hotspots else "low"
    recommendation = (
        "Priority monitoring on top hotspot feeds and verify degraded collectors."
        if top_level in ("high", "critical")
        else "Maintain baseline monitoring and continue anomaly watch."
    )
    payload = {
        "threat_level": top_level,
        "hotspots": hotspots,
        "totals": {
            "aircraft": len(live.get("aircraft", [])),
            "ships": len(live.get("ships", [])),
            "satellites": len(live.get("satellites", [])),
            "earthquakes": len(live.get("earthquakes", [])),
            "weather_alerts": len(live.get("weather_alerts", [])),
            "threats": len(live.get("threats", [])),
        },
        "recommendation": recommendation,
    }
    return ok(data=payload)


@router.get("/ops/events")
async def get_operational_events(
    limit: int = Query(50, ge=1, le=300),
    ops_service: OperationalEventService = Depends(get_ops_service),
):
    rows = ops_service.get_events(limit)
    return list_ok(rows=rows, meta={"limit": limit})


@router.get("/ops/events/history")
async def get_operational_events_history(
    limit: int = Query(100, ge=1, le=500),
    feed: str | None = Query(None),
    severity: str | None = Query(None),
    from_ts: str | None = Query(None, description="ISO timestamp inclusive start"),
    to_ts: str | None = Query(None, description="ISO timestamp inclusive end"),
    ops_service: OperationalEventService = Depends(get_ops_service),
):
    rows = await ops_service.get_persisted_events(
        limit=limit,
        feed=feed,
        severity=severity,
        from_ts=from_ts,
        to_ts=to_ts,
    )
    return list_ok(
        rows=rows,
        meta={"limit": limit, "feed": feed, "severity": severity, "from_ts": from_ts, "to_ts": to_ts},
    )


@router.post("/copilot/plan")
async def generate_copilot_plan(
    payload: dict,
    cache: CacheService = Depends(get_cache),
    ops_service: OperationalEventService = Depends(get_ops_service),
    alert_service: AlertService = Depends(get_alert_service),
    ai_orchestrator: AIOrchestrator = Depends(get_ai_orchestrator),
):
    objective = str((payload or {}).get("objective") or "").strip() or "Global operational posture"
    try:
        live = await cache.get_all_live()
        ops_events = ops_service.get_events(25)
        alerts = await alert_service.get_active_alerts()
        plan = await asyncio.wait_for(
            ai_orchestrator.generate_copilot_plan(objective, live=live, ops_events=ops_events, alerts=alerts),
            timeout=AI_TIMEOUT,
        )
        return ok(data=plan)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Copilot plan timed out")
