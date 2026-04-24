import asyncio
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import List, Optional

import aiohttp

logger = logging.getLogger("sentinel.collectors.conflicts")


class ConflictCollector:
    """
    Conflict/unrest feed using BBC World News RSS.
    """

    URLS = [
        "https://feeds.bbci.co.uk/news/world/rss.xml",
        "https://feeds.bbci.co.uk/news/rss.xml",
    ]

    KEYWORDS = {"conflict", "war", "attack", "military", "protest", "clash",
                "strike", "bomb", "troops", "killed", "missile", "explosion",
                "ceasefire", "invasion", "siege", "hostage", "terror"}

    def __init__(self, cache):
        self.cache = cache
        self._running = False
        self.last_count = 0
        self.last_error: Optional[str] = None
        self.last_fetch: Optional[str] = None

    async def run(self) -> None:
        self._running = True
        logger.info("🛰️ Conflict collector started")
        try:
            while self._running:
                try:
                    data = await self._fetch()
                    await self.cache.store_conflicts(data)
                    self.last_count = len(data)
                    self.last_error = None
                    self.last_fetch = datetime.now(tz=timezone.utc).isoformat()
                except Exception as e:
                    self.last_error = str(e)
                    logger.error(f"Conflict collector error: {e}")
                await asyncio.sleep(300)
        finally:
            self._running = False

    async def stop(self) -> None:
        self._running = False

    async def _fetch(self) -> List[dict]:
        timeout = aiohttp.ClientTimeout(total=15)
        headers = {"User-Agent": "SENTINEL/1.0"}
        out: List[dict] = []

        for url in self.URLS:
            try:
                async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
                    async with session.get(url) as resp:
                        if resp.status != 200:
                            continue
                        text = await resp.text()
                root = ET.fromstring(text)
                ns = {"media": "http://search.yahoo.com/mrss/"}
                items = root.findall(".//item")
                for idx, item in enumerate(items):
                    title = (item.findtext("title") or "").strip()
                    link = (item.findtext("link") or "").strip()
                    desc = (item.findtext("description") or "").strip()
                    pub_date = (item.findtext("pubDate") or "").strip()

                    title_lower = title.lower()
                    desc_lower = desc.lower()
                    if not any(kw in title_lower or kw in desc_lower for kw in self.KEYWORDS):
                        continue

                    out.append({
                        "id": f"conf:{idx}:{abs(hash(link + title))}",
                        "type": "conflict_event",
                        "title": title[:180],
                        "url": link,
                        "source": "bbc_world",
                        "latitude": None,
                        "longitude": None,
                        "country": "",
                        "tone": None,
                        "mention_count": 0,
                        "reported_at": pub_date,
                        "threat_score": 0.7,
                    })
                if out:
                    break
            except Exception as e:
                logger.warning(f"Conflict fetch error {url}: {e}")
                continue

        return out[:50]

    def status(self) -> dict:
        confidence = 70 if not self.last_error else 45
        return {
            "name": "conflicts",
            "source": "bbc_rss",
            "running": self._running,
            "count": self.last_count,
            "last_error": self.last_error,
            "confidence": confidence,
            "last_fetch": self.last_fetch,
        }
