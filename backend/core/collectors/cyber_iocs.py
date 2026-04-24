import asyncio
import csv
import io
import logging
import re
from datetime import datetime, timezone
from typing import List, Optional

import aiohttp
import httpx

from core.config import settings

logger = logging.getLogger("sentinel.collectors.cyber_iocs")


class CyberIocCollector:
    """
    Keyless IOC feed via URLhaus online CSV.
    https://urlhaus.abuse.ch/api/
    """

    URL = "https://urlhaus.abuse.ch/downloads/json_recent/"
    _IP_RE = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}$")

    def __init__(self, cache):
        self.cache = cache
        self._running = False
        self.last_count = 0
        self.last_error: Optional[str] = None
        self.last_fetch: Optional[str] = None

    async def run(self) -> None:
        self._running = True
        logger.info("🧪 Cyber IOC collector started")
        try:
            while self._running:
                try:
                    data = await self._fetch()
                    await self.cache.store_cyber_iocs(data)
                    self.last_count = len(data)
                    self.last_error = None
                    self.last_fetch = datetime.now(tz=timezone.utc).isoformat()
                except Exception as e:
                    self.last_error = str(e)
                    logger.error(f"Cyber IOC error: {e}")
                await asyncio.sleep(600)
        finally:
            self._running = False

    async def stop(self) -> None:
        self._running = False

    async def _fetch(self) -> List[dict]:
        timeout = aiohttp.ClientTimeout(total=25)
        headers = {"User-Agent": "SENTINEL/1.0"}
        async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
            async with session.get(self.URL) as resp:
                if resp.status != 200:
                    return []
                raw = await resp.json(content_type=None)

        out: List[dict] = []
        idx = 0
        for _key, entries in raw.items():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                url = (entry.get("url") or "").strip()
                if not url:
                    continue
                try:
                    from urllib.parse import urlparse
                    host = urlparse(url).hostname or ""
                except Exception:
                    host = ""
                payload = (entry.get("threat") or entry.get("url_status") or "").strip()
                date_added = (entry.get("dateadded") or "").strip()
                tags_raw = entry.get("tags") or []
                tags = ", ".join(tags_raw) if isinstance(tags_raw, list) else str(tags_raw)
                out.append({
                    "id": f"ioc:{idx}:{abs(hash(url))}",
                    "type": "cyber_ioc",
                    "url": url,
                    "host": host,
                    "payload": payload,
                    "tags": tags,
                    "date_added": date_added,
                    "source": "urlhaus",
                    "threat_score": 0.72,
                    "latitude": None,
                    "longitude": None,
                })
                idx += 1
                if len(out) >= 500:
                    break
            if len(out) >= 500:
                break
        if settings.IP_GEO_ENABLED and settings.IP_GEO_PROVIDER == "ip-api":
            await self._enrich_geo_ip_api(out)
        return out

    async def _enrich_geo_ip_api(self, rows: List[dict]) -> None:
        candidates = []
        for r in rows:
            host = (r.get("host") or "").strip()
            if self._IP_RE.match(host):
                candidates.append(r)
            if len(candidates) >= min(60, len(rows)):
                break
        if not candidates:
            return

        base = (settings.IP_API_BASE_URL or "http://ip-api.com/json").rstrip("/")
        timeout = httpx.Timeout(8.0, connect=5.0)
        async with httpx.AsyncClient(timeout=timeout, headers={"User-Agent": "SENTINEL/1.0"}) as client:
            for row in candidates:
                ip = row.get("host")
                try:
                    resp = await client.get(f"{base}/{ip}?fields=status,country,lat,lon")
                    if resp.status_code != 200:
                        continue
                    data = resp.json()
                    if data.get("status") != "success":
                        continue
                    lat = data.get("lat")
                    lon = data.get("lon")
                    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
                        row["latitude"] = float(lat)
                        row["longitude"] = float(lon)
                        if not row.get("country"):
                            row["country"] = data.get("country", "")
                except Exception:
                    continue

    def status(self) -> dict:
        confidence = 75 if not self.last_error else 45
        return {
            "name": "cyber_iocs",
            "source": "urlhaus",
            "running": self._running,
            "count": self.last_count,
            "last_error": self.last_error,
            "confidence": confidence,
            "last_fetch": self.last_fetch,
        }

