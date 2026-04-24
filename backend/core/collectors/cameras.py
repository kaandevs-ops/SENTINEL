import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Tuple

import aiohttp

from core.config import settings

logger = logging.getLogger("sentinel.collectors.cameras")


def _parse_bboxes(spec: str) -> List[Tuple[float, float, float, float]]:
    out: List[Tuple[float, float, float, float]] = []
    for part in (spec or "").split(";"):
        part = part.strip()
        if not part:
            continue
        vals = [v.strip() for v in part.split(",")]
        if len(vals) != 4:
            continue
        try:
            min_lon, min_lat, max_lon, max_lat = [float(x) for x in vals]
        except Exception:
            continue
        out.append((min_lon, min_lat, max_lon, max_lat))
    return out


class CamerasCollector:
    """
    OSINT cameras feed (hybrid):
    - Local/remote catalog for known camera stream URLs (optional)
    - OSM surveillance camera points via Overpass API (no stream URL, but map coverage)
    """

    def __init__(self, cache):
        self.cache = cache
        self._running = False
        self.last_count = 0
        self.last_error: Optional[str] = None
        self.last_fetch: Optional[str] = None

    async def run(self) -> None:
        self._running = True
        logger.info("📷 Cameras collector started")
        try:
            while self._running:
                try:
                    data = await self._fetch()
                    await self.cache.store_cameras(data)
                    self.last_count = len(data)
                    self.last_error = None
                    self.last_fetch = datetime.now(tz=timezone.utc).isoformat()
                except Exception as e:
                    self.last_error = str(e)
                    logger.error(f"Cameras error: {e}")
                await asyncio.sleep(900)
        finally:
            self._running = False

    async def stop(self) -> None:
        self._running = False

    async def _fetch(self) -> List[dict]:
        items: List[dict] = []
        items.extend(await self._load_catalog())
        items.extend(await self._fetch_osm_points())

        # Deduplicate by id
        seen = set()
        out: List[dict] = []
        for it in items:
            it_id = it.get("id")
            if not it_id or it_id in seen:
                continue
            seen.add(it_id)
            out.append(it)
            if len(out) >= int(settings.CAMERA_OSM_MAX or 450):
                break
        return out

    async def _load_catalog(self) -> List[dict]:
        out: List[dict] = []

        # 1) Local catalog
        try:
            base = Path(__file__).resolve().parents[2]  # backend/
            rel = (settings.CAMERA_CATALOG_PATH or "data/cameras.json").lstrip("/").strip()
            path = base / rel
            if path.exists():
                raw = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(raw, list):
                    for row in raw:
                        if not isinstance(row, dict):
                            continue
                        if row.get("latitude") is None or row.get("longitude") is None:
                            continue
                        out.append(
                            {
                                "id": row.get("id") or f"CAT:{abs(hash(row.get('name','')))}",
                                "type": "camera",
                                "name": row.get("name") or "Camera",
                                "provider": row.get("provider") or "catalog",
                                "latitude": float(row.get("latitude")),
                                "longitude": float(row.get("longitude")),
                                "stream_url": row.get("stream_url") or row.get("url") or "",
                                "thumbnail_url": row.get("thumbnail_url") or "",
                                "status": row.get("status") or "unknown",
                                "last_seen": row.get("last_seen") or "",
                                "source": "catalog",
                            }
                        )
        except Exception:
            # Best-effort
            pass

        # 2) Remote catalog
        url = (settings.CAMERA_CATALOG_URL or "").strip()
        if not url:
            return out
        timeout = aiohttp.ClientTimeout(total=20)
        headers = {"User-Agent": "SENTINEL/1.0"}
        try:
            async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
                async with session.get(url) as resp:
                    if resp.status != 200:
                        return out
                    raw = await resp.json(content_type=None)
            if isinstance(raw, list):
                for row in raw:
                    if not isinstance(row, dict):
                        continue
                    if row.get("latitude") is None or row.get("longitude") is None:
                        continue
                    out.append(
                        {
                            "id": row.get("id") or f"REMOTE:{abs(hash(row.get('name','')))}",
                            "type": "camera",
                            "name": row.get("name") or "Camera",
                            "provider": row.get("provider") or "remote_catalog",
                            "latitude": float(row.get("latitude")),
                            "longitude": float(row.get("longitude")),
                            "stream_url": row.get("stream_url") or row.get("url") or "",
                            "thumbnail_url": row.get("thumbnail_url") or "",
                            "status": row.get("status") or "unknown",
                            "last_seen": row.get("last_seen") or "",
                            "source": "remote_catalog",
                        }
                    )
        except Exception:
            return out

        return out

    async def _fetch_osm_points(self) -> List[dict]:
        bboxes = _parse_bboxes(settings.CAMERA_OSM_BBOXES)
        if not bboxes:
            return []

        # Build a single Overpass query with multiple bboxes to reduce calls.
        bbox_parts = []
        for (min_lon, min_lat, max_lon, max_lat) in bboxes:
            bbox_parts.append(f"({min_lat},{min_lon},{max_lat},{max_lon})")

        # Find surveillance cameras (nodes) with tags suggesting camera.
        # Note: This is OSINT-friendly but does not include stream URLs.
        node_queries = "".join([
            f"node{bb}[man_made=surveillance];"
            for bb in bbox_parts
        ])
        query = f"[out:json][timeout:25];({node_queries});out body 700;"

        timeout = aiohttp.ClientTimeout(total=30)
        headers = {"User-Agent": "SENTINEL/1.0"}
        url = (settings.CAMERA_OVERPASS_URL or "").strip() or "https://overpass-api.de/api/interpreter"
        try:
            async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
                async with session.post(url, data=query) as resp:
                    if resp.status != 200:
                        return []
                    raw = await resp.json(content_type=None)
        except Exception:
            return []

        elements = raw.get("elements") or []
        out: List[dict] = []
        for el in elements:
            if not isinstance(el, dict):
                continue
            if el.get("type") != "node":
                continue
            lat = el.get("lat")
            lon = el.get("lon")
            if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
                continue
            node_id = el.get("id")
            tags = el.get("tags") or {}
            name = tags.get("name") or tags.get("operator") or "OSM Camera"
            out.append(
                {
                    "id": f"OSM:{node_id}",
                    "type": "camera",
                    "name": str(name)[:80],
                    "provider": "osm",
                    "latitude": float(lat),
                    "longitude": float(lon),
                    "stream_url": "",
                    "thumbnail_url": "",
                    "status": "unknown",
                    "last_seen": "",
                    "osm_url": f"https://www.openstreetmap.org/node/{node_id}",
                    "source": "osm_overpass",
                }
            )
            if len(out) >= int(settings.CAMERA_OSM_MAX or 450):
                break
        return out

    def status(self) -> dict:
        confidence = 78 if not self.last_error else 45
        return {
            "name": "cameras",
            "source": "osm+catalog",
            "running": self._running,
            "count": self.last_count,
            "last_error": self.last_error,
            "confidence": confidence,
            "last_fetch": self.last_fetch,
        }

