from typing import Optional
from fastapi import APIRouter, Depends, Query

from api.deps import get_cache
from api.response import list_ok, ok
from services.cache_service import CacheService

router = APIRouter()


@router.get("/live")
async def get_live_entities(cache: CacheService = Depends(get_cache)):
    return ok(data=await cache.get_all_live())


@router.get("/aircraft")
async def get_aircraft(
    country: Optional[str] = Query(None, description="Filter by country"),
    on_ground: Optional[bool] = Query(None, description="Filter airborne/grounded"),
    limit: int = Query(500, le=5000),
    min_altitude: Optional[float] = Query(None),
    cache: CacheService = Depends(get_cache),
):
    data = await cache.get("live:aircraft") or []
    if country:
        data = [a for a in data if (a.get("country") or "").lower() == country.lower()]
    if on_ground is not None:
        data = [a for a in data if a.get("on_ground") == on_ground]
    if min_altitude is not None:
        data = [a for a in data if (a.get("altitude") or 0) >= min_altitude]
    rows = data[:limit]
    return list_ok(
        rows=rows,
        meta={"country": country, "on_ground": on_ground, "min_altitude": min_altitude, "limit": limit},
    )


@router.get("/aircraft/{icao}")
async def get_aircraft_by_id(icao: str, cache: CacheService = Depends(get_cache)):
    data = await cache.get("live:aircraft") or []
    for a in data:
        if a.get("id", "").lower() == icao.lower() or (a.get("callsign") or "").lower() == icao.lower():
            return ok(data=a)
    return ok(data=None, message="not_found", meta={"icao": icao})


@router.get("/ships")
async def get_ships(
    flag: Optional[str] = Query(None),
    ship_type: Optional[str] = Query(None),
    limit: int = Query(200, le=1000),
    cache: CacheService = Depends(get_cache),
):
    data = await cache.get("live:ships") or []
    if flag:
        data = [s for s in data if (s.get("flag") or "").lower() == flag.lower()]
    if ship_type:
        data = [s for s in data if (s.get("ship_type") or "").lower() == ship_type.lower()]
    rows = data[:limit]
    return list_ok(rows=rows, meta={"flag": flag, "ship_type": ship_type, "limit": limit})


@router.get("/satellites")
async def get_satellites(
    limit: int = Query(100, le=500),
    cache: CacheService = Depends(get_cache),
):
    data = await cache.get("live:satellites") or []
    rows = data[:limit]
    return list_ok(rows=rows, meta={"limit": limit})


@router.get("/stats")
async def get_entity_stats(cache: CacheService = Depends(get_cache)):
    aircraft = await cache.get("live:aircraft") or []
    ships = await cache.get("live:ships") or []
    satellites = await cache.get("live:satellites") or []

    # Aircraft by country
    countries: dict = {}
    airborne = 0
    for a in aircraft:
        c = a.get("country", "Unknown")
        countries[c] = countries.get(c, 0) + 1
        if not a.get("on_ground"):
            airborne += 1

    top_countries = sorted(countries.items(), key=lambda x: x[1], reverse=True)[:10]

    payload = {
        "aircraft": {
            "total": len(aircraft),
            "airborne": airborne,
            "on_ground": len(aircraft) - airborne,
            "top_countries": [{"country": c, "count": n} for c, n in top_countries],
        },
        "ships": {"total": len(ships)},
        "satellites": {"total": len(satellites)},
    }
    return ok(data=payload)
