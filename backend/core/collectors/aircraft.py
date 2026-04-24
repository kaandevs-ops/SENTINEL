import asyncio
import logging
from collections import deque
from datetime import datetime
from typing import Dict, Deque, List, Optional, Tuple
import aiohttp
from core.config import settings

logger = logging.getLogger("sentinel.collectors.aircraft")
OPENSKY_URL = "https://opensky-network.org/api/states/all"
_BACKOFF_STEPS = [60, 120, 240, 300]
TRAIL_MAX = 10  # Son 10 pozisyon

class RateLimitError(Exception):
    pass

class AircraftCollector:
    def __init__(self, cache):
        self.cache = cache
        self._running = False
        self.last_count = 0
        self.last_fetch: Optional[datetime] = None
        self.last_error: Optional[str] = None
        self._backoff_idx = 0
        # id -> deque of (lat, lon)
        self._trails: Dict[str, Deque[Tuple[float, float]]] = {}

    async def run(self) -> None:
        self._running = True
        logger.info("✈️  Aircraft collector started")
        try:
            while self._running:
                try:
                    data = await self._fetch()
                    if data:
                        data = self._attach_trails(data)
                        await self.cache.store_aircraft(data)
                        self.last_count = len(data)
                        self.last_fetch = datetime.utcnow()
                        self.last_error = None
                        self._backoff_idx = 0
                except RateLimitError:
                    wait = _BACKOFF_STEPS[min(self._backoff_idx, len(_BACKOFF_STEPS) - 1)]
                    self._backoff_idx += 1
                    logger.warning(f"OpenSky 429 — backoff {wait}s (attempt #{self._backoff_idx})")
                    self.last_error = "rate_limited"
                    await asyncio.sleep(wait)
                    continue
                except Exception as e:
                    self.last_error = str(e)
                    logger.error(f"Aircraft fetch error: {e}")
                await asyncio.sleep(settings.DATA_REFRESH_INTERVAL)
        finally:
            self._running = False

    def _attach_trails(self, aircraft: List[dict]) -> List[dict]:
        seen_ids = set()
        for a in aircraft:
            aid = a["id"]
            seen_ids.add(aid)
            lat, lon = a["latitude"], a["longitude"]
            if aid not in self._trails:
                self._trails[aid] = deque(maxlen=TRAIL_MAX)
            self._trails[aid].append({"lat": round(lat, 4), "lon": round(lon, 4)})
            a["trail"] = list(self._trails[aid])
        # Temizle: uçmayan uçakları sil (bellek tasarrufu)
        stale = [k for k in self._trails if k not in seen_ids]
        for k in stale[:500]:
            del self._trails[k]
        return aircraft

    async def stop(self) -> None:
        self._running = False

    async def _fetch(self) -> List[dict]:
        auth = None
        if settings.OPENSKY_USERNAME and settings.OPENSKY_PASSWORD:
            auth = aiohttp.BasicAuth(settings.OPENSKY_USERNAME, settings.OPENSKY_PASSWORD)
        timeout = aiohttp.ClientTimeout(total=20)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(OPENSKY_URL, auth=auth) as resp:
                if resp.status == 429:
                    raise RateLimitError()
                if resp.status != 200:
                    logger.warning(f"OpenSky {resp.status}")
                    return []
                raw = await resp.json()
        aircraft = []
        for s in (raw.get("states") or []):
            if s[5] is None or s[6] is None:
                continue
            aircraft.append({
                "id":            s[0],
                "callsign":      (s[1] or "").strip() or s[0],
                "country":       s[2],
                "longitude":     s[5],
                "latitude":      s[6],
                "altitude":      s[7] or s[13] or 0,
                "on_ground":     s[8],
                "speed":         round((s[9] or 0) * 3.6, 1),
                "heading":       s[10] or 0,
                "vertical_rate": s[11] or 0,
                "squawk":        s[14],
                "last_contact":  s[4],
                "type":          "aircraft",
            })
        return aircraft

    def status(self) -> dict:
        if self.last_error == "rate_limited":
            confidence = 55
        elif self.last_error:
            confidence = 40
        elif self.last_fetch:
            age_sec = (datetime.utcnow() - self.last_fetch).total_seconds()
            confidence = 90 if age_sec <= 120 else 75 if age_sec <= 300 else 60
        else:
            confidence = 35
        return {
            "name": "aircraft",
            "source": "opensky",
            "running": self._running,
            "count": self.last_count,
            "last_fetch": self.last_fetch.isoformat() if self.last_fetch else None,
            "last_error": self.last_error,
            "confidence": confidence,
        }
