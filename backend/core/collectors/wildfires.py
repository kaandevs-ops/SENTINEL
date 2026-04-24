import asyncio
import logging
from datetime import datetime, timezone
from typing import List, Optional

import aiohttp

logger = logging.getLogger("sentinel.collectors.wildfires")


class WildfireCollector:
    """
    Keyless OSINT feed for active wildfires using NASA EONET v3.
    EONET returns events with one or more geometries (Point / Polygon).
    We convert them into point markers for map display.
    """

    URL = "https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open&limit=200"

    def __init__(self, cache):
        self.cache = cache
        self._running = False
        self.last_count = 0
        self.last_error: Optional[str] = None
        self.last_fetch: Optional[str] = None

    async def run(self) -> None:
        self._running = True
        logger.info("🔥 Wildfires collector started")
        try:
            while self._running:
                try:
                    data = await self._fetch()
                    await self.cache.store_wildfires(data)
                    self.last_count = len(data)
                    self.last_error = None
                    self.last_fetch = datetime.now(tz=timezone.utc).isoformat()
                except Exception as e:
                    self.last_error = str(e)
                    logger.error(f"Wildfires error: {e}")
                await asyncio.sleep(300)
        finally:
            self._running = False

    async def stop(self) -> None:
        self._running = False

    async def _fetch(self) -> List[dict]:
        timeout = aiohttp.ClientTimeout(total=20)
        headers = {"User-Agent": "SENTINEL/1.0"}
        async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
            async with session.get(self.URL) as resp:
                if resp.status != 200:
                    return []
                raw = await resp.json(content_type=None)

        events = raw.get("events") or []
        out: List[dict] = []

        for ev in events:
            ev_id = ev.get("id") or ""
            title = ev.get("title") or "Wildfire"
            sources = ev.get("sources") or []
            source_url = sources[0].get("url") if sources and isinstance(sources[0], dict) else ""
            updated = ev.get("updated") or ev.get("closed") or ""
            geometries = ev.get("geometry") or []

            for g in geometries:
                if not isinstance(g, dict):
                    continue
                # EONET v3 new format: type/coordinates directly on geometry object
                g_type = g.get("type")
                coords = g.get("coordinates")
                dt = g.get("date") or updated or ""

                lon = lat = None
                precision = "unknown"
                if g_type == "Point" and isinstance(coords, list) and len(coords) >= 2:
                    lon, lat = coords[0], coords[1]
                    precision = "point"
                elif g_type == "Polygon" and isinstance(coords, list) and coords and isinstance(coords[0], list):
                    # Use polygon centroid (best-effort)
                    pts = coords[0]
                    if pts and all(isinstance(p, list) and len(p) >= 2 for p in pts):
                        lon = sum(p[0] for p in pts) / len(pts)
                        lat = sum(p[1] for p in pts) / len(pts)
                        precision = "polygon_centroid"

                if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
                    continue

                marker_id = f"{ev_id}:{dt}:{precision}"
                out.append(
                    {
                        "id": marker_id,
                        "type": "wildfire",
                        "title": title,
                        "url": source_url,
                        "latitude": float(lat),
                        "longitude": float(lon),
                        "reported_at": dt,
                        "updated": updated,
                        "geo_precision": precision,
                        "source": "eonet",
                        "threat_score": 0.6,
                    }
                )

        # Keep a reasonable bound for UI.
        return out[:600]

    def status(self) -> dict:
        confidence = 82 if not self.last_error else 45
        return {
            "name": "wildfires",
            "source": "nasa_eonet",
            "running": self._running,
            "count": self.last_count,
            "last_error": self.last_error,
            "confidence": confidence,
            "last_fetch": self.last_fetch,
        }

