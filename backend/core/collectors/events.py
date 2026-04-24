import asyncio
import logging
from datetime import datetime, timezone
from typing import List, Optional
import aiohttp
import httpx

from core.config import settings

logger = logging.getLogger("sentinel.collectors.events")


class EarthquakeCollector:
    URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_hour.geojson"

    def __init__(self, cache):
        self.cache = cache
        self._running = False
        self.last_count = 0
        self.last_error: Optional[str] = None

    async def run(self) -> None:
        self._running = True
        logger.info("🌍 Earthquake collector started")
        try:
            while self._running:
                try:
                    data = await self._fetch()
                    await self.cache.store_earthquakes(data)
                    self.last_count = len(data)
                    self.last_error = None
                except Exception as e:
                    self.last_error = str(e)
                    logger.error(f"Earthquake error: {e}")
                await asyncio.sleep(120)
        finally:
            self._running = False

    async def stop(self) -> None:
        self._running = False

    async def _fetch(self) -> List[dict]:
        timeout = aiohttp.ClientTimeout(total=15)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(self.URL) as resp:
                if resp.status != 200:
                    return []
                raw = await resp.json()
        events = []
        for feat in raw.get("features", []):
            props = feat["properties"]
            coords = feat["geometry"]["coordinates"]
            mag = props.get("mag") or 0
            events.append({
                "id":          feat["id"],
                "type":        "earthquake",
                "title":       props.get("title", ""),
                "magnitude":   mag,
                "place":       props.get("place", ""),
                "longitude":   coords[0],
                "latitude":    coords[1],
                "depth_km":    coords[2],
                "time":        datetime.fromtimestamp(props["time"] / 1000, tz=timezone.utc).isoformat(),
                "url":         props.get("url", ""),
                "threat_score": min(mag / 9.0, 1.0),
            })
        return events

    def status(self) -> dict:
        confidence = 88 if not self.last_error else 45
        return {
            "name": "earthquakes",
            "source": "usgs",
            "running": self._running,
            "count": self.last_count,
            "last_error": self.last_error,
            "confidence": confidence,
        }


class WeatherAlertCollector:
    URL = "https://api.weather.gov/alerts/active?status=actual&message_type=alert&urgency=Immediate"

    def __init__(self, cache):
        self.cache = cache
        self._running = False
        self.last_count = 0
        self.last_error: Optional[str] = None

    async def run(self) -> None:
        self._running = True
        logger.info("🌪️  Weather collector started")
        try:
            while self._running:
                try:
                    data = await self._fetch()
                    await self.cache.store_weather_alerts(data)
                    self.last_count = len(data)
                    self.last_error = None
                except Exception as e:
                    self.last_error = str(e)
                    logger.error(f"Weather error: {e}")
                await asyncio.sleep(300)
        finally:
            self._running = False

    async def stop(self) -> None:
        self._running = False

    async def _fetch(self) -> List[dict]:
        timeout = aiohttp.ClientTimeout(total=15)
        headers = {"User-Agent": "SENTINEL/1.0"}
        try:
            async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
                async with session.get(self.URL) as resp:
                    if resp.status != 200:
                        return []
                    raw = await resp.json()
        except Exception:
            return []
        alerts = []
        for feat in raw.get("features", []):
            props = feat["properties"]
            geo = feat.get("geometry") or {}
            coords = None
            if geo.get("type") == "Point":
                coords = geo["coordinates"]
            elif geo.get("type") == "Polygon":
                pts = geo["coordinates"][0]
                coords = [sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)]
            sev_map = {"Extreme": 0.9, "Severe": 0.7, "Moderate": 0.5, "Minor": 0.3}
            alerts.append({
                "id":          props.get("id", ""),
                "type":        "weather_alert",
                "event":       props.get("event", ""),
                "headline":    props.get("headline", ""),
                "description": (props.get("description") or "")[:500],
                "severity":    props.get("severity", "Unknown"),
                "area":        props.get("areaDesc", ""),
                "longitude":   coords[0] if coords else None,
                "latitude":    coords[1] if coords else None,
                "expires":     props.get("expires", ""),
                "threat_score": sev_map.get(props.get("severity"), 0.2),
            })
        return alerts

    def status(self) -> dict:
        confidence = 85 if not self.last_error else 45
        return {
            "name": "weather",
            "source": "weather.gov",
            "running": self._running,
            "count": self.last_count,
            "last_error": self.last_error,
            "confidence": confidence,
        }


class NewsCollector:
    # GDELT API (2026) requires OR groups in parentheses and rejects very short timespans.
    # Keep this conservative to reduce rate-limits while ensuring non-empty results.
    GDELT_URL = (
        "https://api.gdeltproject.org/api/v2/doc/doc"
        "?query=%28conflict%20OR%20attack%20OR%20disaster%20OR%20threat%29"
        "&mode=artlist&maxrecords=50&format=json&timespan=1h"
    )

    def __init__(self, cache):
        self.cache = cache
        self._running = False
        self.last_count = 0
        self.last_error: Optional[str] = None
        self._last_geo_ts: float = 0.0

    async def run(self) -> None:
        self._running = True
        logger.info("📰 News collector started")
        try:
            while self._running:
                try:
                    data = await self._fetch()
                    await self.cache.store_news(data)
                    self.last_count = len(data)
                    self.last_error = None
                except Exception as e:
                    self.last_error = str(e)
                    logger.error(f"News error: {e}")
                await asyncio.sleep(300)
        finally:
            self._running = False

    async def stop(self) -> None:
        self._running = False

    async def _fetch(self) -> List[dict]:
        timeout = aiohttp.ClientTimeout(total=20)
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(self.GDELT_URL) as resp:
                    if resp.status != 200:
                        return []
                    raw = await resp.json(content_type=None)
        except Exception:
            return []
        items = [
            {
                "id":       (art.get("url") or "")[-64:],
                "type":     "news",
                "title":    art.get("title", ""),
                "url":      art.get("url", ""),
                "source":   art.get("domain", ""),
                "country":  art.get("sourcecountry", ""),
                "seendate": art.get("seendate", ""),
                "latitude":  None,
                "longitude": None,
                "geo_precision": None,
            }
            for art in (raw.get("articles") or [])
        ]
        if settings.NEWS_GEO_ENABLED and settings.NEWS_GEO_PROVIDER == "restcountries":
            await self._enrich_country_centroids(items)
        return items

    async def _enrich_country_centroids(self, items: List[dict]) -> None:
        """
        Best-effort country centroid enrichment for news items.
        Uses country code from GDELT (sourcecountry) and Rest Countries API.
        Cached under geo:cc:<CC> with TTL.
        """
        max_per_tick = max(0, int(settings.NEWS_GEO_MAX_PER_TICK))
        if max_per_tick == 0:
            return

        candidates: List[dict] = []
        for it in items:
            cc = (it.get("country") or "").strip()
            if len(cc) != 2:
                continue
            if it.get("latitude") is not None and it.get("longitude") is not None:
                continue
            candidates.append(it)
            if len(candidates) >= max_per_tick:
                break

        if not candidates:
            return

        timeout = httpx.Timeout(8.0, connect=5.0)
        async with httpx.AsyncClient(timeout=timeout, headers={"User-Agent": "SENTINEL/1.0"}) as client:
            for it in candidates:
                cc = (it.get("country") or "").strip().lower()
                cache_key = f"geo:cc:{cc}"
                cached = await self.cache.get(cache_key)
                if isinstance(cached, dict) and cached.get("ok") is True:
                    lat = cached.get("lat")
                    lon = cached.get("lon")
                    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
                        it["latitude"] = float(lat)
                        it["longitude"] = float(lon)
                        it["geo_precision"] = "country"
                    continue

                # Throttle
                now = asyncio.get_event_loop().time()
                delta = now - self._last_geo_ts
                wait = max(0.0, float(settings.NEWS_GEO_MIN_INTERVAL_SEC) - delta)
                if wait:
                    await asyncio.sleep(wait)

                try:
                    r = await client.get(f"https://restcountries.com/v3.1/alpha/{cc}")
                    if r.status_code != 200:
                        await self.cache.set(cache_key, {"ok": False}, ttl=86400)
                        continue
                    data = r.json()
                    # Response is a list of countries
                    if not isinstance(data, list) or not data:
                        await self.cache.set(cache_key, {"ok": False}, ttl=86400)
                        continue
                    country = data[0]
                    latlng = country.get("latlng")
                    if isinstance(latlng, list) and len(latlng) >= 2:
                        lat, lon = latlng[0], latlng[1]
                        if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
                            it["latitude"] = float(lat)
                            it["longitude"] = float(lon)
                            it["geo_precision"] = "country"
                            await self.cache.set(cache_key, {"ok": True, "lat": float(lat), "lon": float(lon)}, ttl=86400 * 30)
                except Exception:
                    continue
                finally:
                    self._last_geo_ts = asyncio.get_event_loop().time()

    def status(self) -> dict:
        confidence = 78 if not self.last_error else 45
        if settings.NEWS_GEO_ENABLED:
            confidence = min(90, confidence + 5)
        return {
            "name": "news",
            "source": "gdelt",
            "running": self._running,
            "count": self.last_count,
            "last_error": self.last_error,
            "confidence": confidence,
        }


class ThreatCollector:
    FEODO_URL = "https://feodotracker.abuse.ch/downloads/ipblocklist.json"

    def __init__(self, cache):
        self.cache = cache
        self._running = False
        self.last_count = 0
        self.last_error: Optional[str] = None
        self._last_geo_ts: float = 0.0

    async def run(self) -> None:
        self._running = True
        logger.info("🔴 Threat collector started")
        try:
            while self._running:
                try:
                    data = await self._fetch()
                    await self.cache.store_threats(data)
                    self.last_count = len(data)
                    self.last_error = None
                except Exception as e:
                    self.last_error = str(e)
                    logger.error(f"Threat error: {e}")
                await asyncio.sleep(600)
        finally:
            self._running = False

    async def stop(self) -> None:
        self._running = False

    async def _fetch(self) -> List[dict]:
        timeout = aiohttp.ClientTimeout(total=20)
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(self.FEODO_URL) as resp:
                    if resp.status != 200:
                        return []
                    raw = await resp.json(content_type=None)
        except Exception as e:
            logger.error(f"Feodo error: {e}")
            return []
        threats = [
            {
                "id":         item.get("ip_address", ""),
                "type":       "cyber_threat",
                "ip":         item.get("ip_address", ""),
                "malware":    item.get("malware", ""),
                "country":    item.get("country", ""),
                "as_name":    item.get("as_name", ""),
                "first_seen": item.get("first_seen", ""),
                "latitude":   None,
                "longitude":  None,
                "threat_score": 0.8,
            }
            for item in (raw if isinstance(raw, list) else [])[:200]
        ]
        if settings.IP_GEO_ENABLED and settings.IP_GEO_PROVIDER == "ip-api":
            await self._enrich_geo_ip_api(threats)
        return threats

    async def _enrich_geo_ip_api(self, threats: List[dict]) -> None:
        """
        Best-effort geolocation for threat IPs.
        Uses cache keys geo:ip:<ip> to avoid repeated lookups.
        """
        max_per_tick = max(0, int(settings.IP_GEO_MAX_PER_TICK))
        if max_per_tick == 0:
            return

        # Select threats without coordinates (and with valid IP)
        candidates: List[dict] = []
        for t in threats:
            ip = (t.get("ip") or "").strip()
            if not ip:
                continue
            if t.get("latitude") is not None and t.get("longitude") is not None:
                continue
            candidates.append(t)
            if len(candidates) >= max_per_tick:
                break

        if not candidates:
            return

        base = (settings.IP_API_BASE_URL or "http://ip-api.com/json").rstrip("/")
        timeout = httpx.Timeout(8.0, connect=5.0)

        async with httpx.AsyncClient(timeout=timeout, headers={"User-Agent": "SENTINEL/1.0"}) as client:
            for t in candidates:
                ip = (t.get("ip") or "").strip()
                cache_key = f"geo:ip:{ip}"

                cached = await self.cache.get(cache_key)
                if isinstance(cached, dict):
                    lat = cached.get("lat")
                    lon = cached.get("lon")
                    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
                        t["latitude"] = float(lat)
                        t["longitude"] = float(lon)
                    continue

                # Throttle: public endpoints will rate-limit fast.
                now = asyncio.get_event_loop().time()
                delta = now - self._last_geo_ts
                wait = max(0.0, float(settings.IP_GEO_MIN_INTERVAL_SEC) - delta)
                if wait:
                    await asyncio.sleep(wait)

                try:
                    r = await client.get(f"{base}/{ip}?fields=status,message,country,lat,lon,as,org,query")
                    if r.status_code != 200:
                        continue
                    data = r.json()
                    if data.get("status") != "success":
                        # Cache negative for a short time to avoid hammering.
                        await self.cache.set(cache_key, {"ok": False}, ttl=3600)
                        continue

                    lat = data.get("lat")
                    lon = data.get("lon")
                    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
                        t["latitude"] = float(lat)
                        t["longitude"] = float(lon)
                        # Also enrich text fields if missing.
                        if not t.get("country"):
                            t["country"] = data.get("country", "") or ""
                        if not t.get("as_name"):
                            t["as_name"] = data.get("as", "") or data.get("org", "") or ""

                        await self.cache.set(cache_key, {"ok": True, "lat": float(lat), "lon": float(lon)}, ttl=86400)
                except Exception:
                    continue
                finally:
                    self._last_geo_ts = asyncio.get_event_loop().time()

    def status(self) -> dict:
        confidence = 76 if not self.last_error else 45
        if settings.IP_GEO_ENABLED:
            confidence = min(88, confidence + 4)
        return {
            "name": "threats",
            "source": "abusech_feodo",
            "running": self._running,
            "count": self.last_count,
            "last_error": self.last_error,
            "confidence": confidence,
        }
