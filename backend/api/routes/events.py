from typing import Optional
from fastapi import APIRouter, Depends, Query

from api.deps import get_cache
from api.response import list_ok, ok
from services.cache_service import CacheService

router = APIRouter()


@router.get("/")
async def get_all_events(cache: CacheService = Depends(get_cache)):
    payload = {
        "earthquakes": await cache.get("live:earthquakes") or [],
        "weather_alerts": await cache.get("live:weather_alerts") or [],
        "news": await cache.get("live:news") or [],
        "threats": await cache.get("live:threats") or [],
    }
    return ok(data=payload)


@router.get("/earthquakes")
async def get_earthquakes(
    min_magnitude: float = Query(0.0),
    cache: CacheService = Depends(get_cache),
):
    data = await cache.get("live:earthquakes") or []
    if min_magnitude > 0:
        data = [e for e in data if (e.get("magnitude") or 0) >= min_magnitude]
    return list_ok(rows=data, meta={"min_magnitude": min_magnitude})


@router.get("/weather")
async def get_weather(
    severity: Optional[str] = Query(None),
    cache: CacheService = Depends(get_cache),
):
    data = await cache.get("live:weather_alerts") or []
    if severity:
        data = [w for w in data if (w.get("severity") or "").lower() == severity.lower()]
    return list_ok(rows=data, meta={"severity": severity})


@router.get("/news")
async def get_news(
    limit: int = Query(50, le=200),
    cache: CacheService = Depends(get_cache),
):
    data = await cache.get("live:news") or []
    rows = data[:limit]
    return list_ok(rows=rows, meta={"limit": limit})


@router.get("/threats")
async def get_threats(
    malware: Optional[str] = Query(None),
    country: Optional[str] = Query(None),
    cache: CacheService = Depends(get_cache),
):
    data = await cache.get("live:threats") or []
    if malware:
        data = [t for t in data if malware.lower() in (t.get("malware") or "").lower()]
    if country:
        data = [t for t in data if (t.get("country") or "").lower() == country.lower()]
    return list_ok(rows=data, meta={"malware": malware, "country": country})


@router.get("/summary")
async def get_event_summary(cache: CacheService = Depends(get_cache)):
    eq = await cache.get("live:earthquakes") or []
    wx = await cache.get("live:weather_alerts") or []
    th = await cache.get("live:threats") or []
    news = await cache.get("live:news") or []

    max_eq = max((e.get("magnitude", 0) for e in eq), default=0)
    extreme_wx = [w for w in wx if w.get("severity") in ("Extreme", "Severe")]

    payload = {
        "earthquakes": {"count": len(eq), "max_magnitude": max_eq},
        "weather_alerts": {"count": len(wx), "extreme_count": len(extreme_wx)},
        "cyber_threats": {"count": len(th)},
        "news": {"count": len(news)},
    }
    return ok(data=payload)
