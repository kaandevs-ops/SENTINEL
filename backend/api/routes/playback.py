import json
from typing import Optional
from fastapi import APIRouter, Query
from sqlalchemy import text
from db.database import AsyncSessionLocal
from api.response import ok

router = APIRouter()

@router.get("/range")
async def playback_range():
    async with AsyncSessionLocal() as session:
        result = await session.execute(text("""
            SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest,
                   COUNT(DISTINCT timestamp) as frame_count, COUNT(*) as total_entities
            FROM position_history
        """))
        row = result.fetchone()
    if not row or not row.oldest:
        return ok(data={"has_data": False, "oldest": None, "newest": None, "frame_count": 0, "total_entities": 0})
    return ok(data={"has_data": True, "oldest": row.oldest, "newest": row.newest,
                    "frame_count": row.frame_count, "total_entities": row.total_entities})

@router.get("/frames")
async def playback_frames(limit: int = Query(500, ge=1, le=1000), offset: int = Query(0, ge=0)):
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text("SELECT DISTINCT timestamp FROM position_history ORDER BY timestamp ASC LIMIT :limit OFFSET :offset"),
            {"limit": limit, "offset": offset},
        )
        timestamps = [row.timestamp for row in result.fetchall()]
    return ok(data={"timestamps": timestamps, "count": len(timestamps)})

@router.get("/snapshot")
async def playback_snapshot(
    ts: str = Query(...),
    entity_type: Optional[str] = Query(None),
    limit: int = Query(3000, ge=1, le=5000),
):
    async with AsyncSessionLocal() as session:
        nearest = await session.execute(
            text("SELECT timestamp FROM position_history ORDER BY ABS(JULIANDAY(timestamp) - JULIANDAY(:ts)) LIMIT 1"),
            {"ts": ts},
        )
        nearest_row = nearest.fetchone()
        if not nearest_row:
            return ok(data={"timestamp": ts, "entities": [], "count": 0})
        nearest_ts = nearest_row.timestamp
        type_filter = ""
        params = {"ts": nearest_ts, "limit": limit}
        if entity_type and entity_type != "all":
            type_filter = "AND entity_type = :entity_type"
            params["entity_type"] = entity_type
        result = await session.execute(
            text(f"""SELECT entity_type, external_id, name, latitude, longitude,
                            altitude, speed, heading, timestamp, raw_data
                     FROM position_history WHERE timestamp = :ts {type_filter} LIMIT :limit"""),
            params,
        )
        rows = result.fetchall()
    entities = []
    for r in rows:
        raw = {}
        try:
            raw = json.loads(r.raw_data or "{}")
        except Exception:
            pass
        entities.append({
            "entity_type": r.entity_type, "id": r.external_id, "name": r.name,
            "latitude": r.latitude, "longitude": r.longitude, "altitude": r.altitude,
            "speed": r.speed, "heading": r.heading, "timestamp": r.timestamp, **raw,
        })
    return ok(data={
        "timestamp": nearest_ts, "requested_ts": ts, "entities": entities,
        "count": len(entities),
        "aircraft_count": sum(1 for e in entities if e["entity_type"] == "aircraft"),
        "ship_count": sum(1 for e in entities if e["entity_type"] == "ship"),
    })

@router.get("/summary")
async def playback_summary():
    async with AsyncSessionLocal() as session:
        result = await session.execute(text("""
            SELECT entity_type, COUNT(*) as total_rows, COUNT(DISTINCT timestamp) as frame_count,
                   MIN(timestamp) as oldest, MAX(timestamp) as newest
            FROM position_history GROUP BY entity_type
        """))
        rows = result.fetchall()
    summary = {r.entity_type: {"total_rows": r.total_rows, "frame_count": r.frame_count,
                                "oldest": r.oldest, "newest": r.newest} for r in rows}
    return ok(data=summary)
