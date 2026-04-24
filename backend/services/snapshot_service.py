import asyncio, json, logging
from datetime import datetime, timezone
from sqlalchemy import text
from db.database import AsyncSessionLocal

logger = logging.getLogger("sentinel.snapshot")
SNAPSHOT_INTERVAL = 60
RETENTION_DAYS = 3
MAX_AIRCRAFT = 3000

class SnapshotService:
    def __init__(self, cache):
        self.cache = cache
        self._running = False
        self._task = None
        self.last_snapshot = None
        self.last_count = 0

    async def start(self):
        self._running = True
        self._task = asyncio.create_task(self._loop(), name="snapshot_loop")
        logger.info("📸 SnapshotService started")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _loop(self):
        await asyncio.sleep(15)
        while self._running:
            try:
                await self._take_snapshot()
                await self._purge_old()
            except Exception as exc:
                logger.error(f"Snapshot error: {exc}", exc_info=True)
            await asyncio.sleep(SNAPSHOT_INTERVAL)

    async def _take_snapshot(self):
        now = datetime.now(timezone.utc)
        ts = now.isoformat()
        live = await self._safe_get(self.cache.get_all_live)
        aircraft = live.get("aircraft", []) if live else []
        ships = live.get("ships", []) if live else []
        rows = []
        for a in aircraft[:MAX_AIRCRAFT]:
            if a.get("latitude") is None or a.get("longitude") is None:
                continue
            rows.append({
                "entity_type": "aircraft",
                "external_id": str(a.get("id", "")),
                "name": a.get("callsign") or a.get("id") or "",
                "latitude": float(a["latitude"]),
                "longitude": float(a["longitude"]),
                "altitude": float(a.get("altitude") or 0),
                "speed": float(a.get("speed") or 0),
                "heading": float(a.get("heading") or 0),
                "timestamp": ts,
                "raw_data": json.dumps({"country": a.get("country"), "squawk": a.get("squawk"), "on_ground": a.get("on_ground")}),
            })
        for s in (ships or []):
            if s.get("latitude") is None or s.get("longitude") is None:
                continue
            rows.append({
                "entity_type": "ship",
                "external_id": str(s.get("mmsi") or s.get("id", "")),
                "name": s.get("name") or s.get("mmsi") or "",
                "latitude": float(s["latitude"]),
                "longitude": float(s["longitude"]),
                "altitude": 0.0,
                "speed": float(s.get("speed") or 0),
                "heading": float(s.get("heading") or 0),
                "timestamp": ts,
                "raw_data": json.dumps({"flag": s.get("flag"), "ship_type": s.get("ship_type")}),
            })
        if not rows:
            return
        async with AsyncSessionLocal() as session:
            await session.execute(
                text("""INSERT INTO position_history
                    (entity_type, external_id, name, latitude, longitude, altitude, speed, heading, timestamp, raw_data)
                    VALUES (:entity_type, :external_id, :name, :latitude, :longitude, :altitude, :speed, :heading, :timestamp, :raw_data)"""),
                rows,
            )
            await session.commit()
        self.last_snapshot = now
        self.last_count = len(rows)
        logger.info(f"📸 Snapshot saved: {len(rows)} entities @ {ts[:19]}")

    async def _purge_old(self):
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                text(f"DELETE FROM position_history WHERE timestamp < datetime('now', '-{RETENTION_DAYS} days')")
            )
            await session.commit()
            if result.rowcount:
                logger.info(f"📸 Purged {result.rowcount} old rows")

    async def _safe_get(self, fn):
        try:
            return await fn() or {}
        except Exception:
            return {}

    def status(self):
        return {
            "running": self._running,
            "last_snapshot": self.last_snapshot.isoformat() if self.last_snapshot else None,
            "last_count": self.last_count,
        }
