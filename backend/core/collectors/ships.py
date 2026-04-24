import asyncio
import logging
import math
import random
from collections import deque
from datetime import datetime
from typing import Dict, Deque, List, Optional, Tuple
import aiohttp

logger = logging.getLogger("sentinel.collectors.ships")

TRAIL_MAX = 10

MAJOR_SHIPPING_LANES = [
    (30.5, 32.3, "MAERSK CAIRO",     "Panama",      "container"),
    (29.9, 32.5, "MSC ISTANBUL",     "Malta",       "container"),
    (41.0, 29.0, "BOSPHORUS TRADER", "Turkey",      "tanker"),
    (40.8, 28.9, "SEA EAGLE",        "Greece",      "bulk_carrier"),
    (36.5, 15.0, "MEDITERRANEAN SEA","Cyprus",      "container"),
    (37.0, 23.5, "OLYMPIC GLORY",    "Greece",      "tanker"),
    (20.0, 38.5, "RED SEA TRADER",   "Bahrain",     "tanker"),
    (26.5, 56.5, "GULF EXPRESS",     "UAE",         "tanker"),
    (26.0, 57.0, "HORMUZ STAR",      "Iran",        "tanker"),
    (5.0,  73.0, "INDIAN OCEAN",     "India",       "bulk_carrier"),
    (1.2,  104.0,"SINGAPORE EXPRESS","Singapore",   "container"),
    (1.3,  103.8,"PACIFIC BRIDGE",   "HongKong",    "container"),
    (51.0, 2.0,  "CHANNEL HAWK",     "UK",          "container"),
    (50.5, 1.5,  "DOVER STAR",       "Netherlands", "tanker"),
    (40.0, -30.0,"ATLANTIC VOYAGER", "Liberia",     "bulk_carrier"),
    (45.0, -20.0,"NORTH STAR",       "Denmark",     "container"),
]


class ShipCollector:
    def __init__(self, cache):
        self.cache = cache
        self._running = False
        self.last_count = 0
        self.last_error: Optional[str] = None
        self._source_mode = "simulated"
        self._ship_state: List[dict] = self._init_ships()
        self._trails: Dict[str, deque] = {
            s["id"]: deque(maxlen=TRAIL_MAX) for s in self._ship_state
        }

    def _init_ships(self) -> List[dict]:
        ships = []
        for i, (lat, lon, name, flag, ship_type) in enumerate(MAJOR_SHIPPING_LANES):
            ships.append({
                "id":        f"SHIP-{i:04d}",
                "mmsi":      f"2{i:08d}",
                "name":      name,
                "flag":      flag,
                "type":      "ship",
                "ship_type": ship_type,
                "latitude":  lat + random.uniform(-0.5, 0.5),
                "longitude": lon + random.uniform(-0.5, 0.5),
                "speed":     random.uniform(8, 18),
                "heading":   random.uniform(0, 360),
                "status":    "underway",
                "length":    random.choice([180, 220, 300, 340, 400]),
                "draught":   random.uniform(8, 15),
            })
        return ships

    async def run(self) -> None:
        self._running = True
        logger.info("🚢 Ship collector started")
        try:
            while self._running:
                try:
                    data = await self._fetch_ais()
                    if not data:
                        data = self._simulate_movement()
                        self._source_mode = "simulated"
                    else:
                        self._source_mode = "ais_live"
                    data = self._attach_trails(data)
                    await self.cache.store_ships(data)
                    self.last_count = len(data)
                except Exception as e:
                    self.last_error = str(e)
                    logger.error(f"Ship error: {e}")
                    data = self._attach_trails(self._simulate_movement())
                    self._source_mode = "simulated"
                    await self.cache.store_ships(data)
                await asyncio.sleep(60)
        finally:
            self._running = False

    async def stop(self) -> None:
        self._running = False

    def _attach_trails(self, ships: List[dict]) -> List[dict]:
        for s in ships:
            sid = s["id"]
            if sid not in self._trails:
                self._trails[sid] = deque(maxlen=TRAIL_MAX)
            self._trails[sid].append({
                "lat": round(s["latitude"], 4),
                "lon": round(s["longitude"], 4),
            })
            s["trail"] = list(self._trails[sid])
        return ships

    async def _fetch_ais(self) -> List[dict]:
        url = "https://www.vesselfinder.com/api/pub/vesselsonmap?bbox=-180,-90,180,90&zoom=2&mmsi=&show_tag=0"
        timeout = aiohttp.ClientTimeout(total=10)
        try:
            headers = {"User-Agent": "Mozilla/5.0"}
            async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
                async with session.get(url) as resp:
                    if resp.status == 200:
                        raw = await resp.json(content_type=None)
                        if isinstance(raw, list) and raw:
                            ships = []
                            for v in raw[:200]:
                                if len(v) >= 4:
                                    ships.append({
                                        "id":        f"AIS-{v[0]}",
                                        "mmsi":      str(v[0]),
                                        "name":      v[1] if len(v) > 1 else "Unknown",
                                        "latitude":  v[2] / 600000.0 if isinstance(v[2], int) else v[2],
                                        "longitude": v[3] / 600000.0 if isinstance(v[3], int) else v[3],
                                        "speed":     v[4] / 10.0 if len(v) > 4 else 0,
                                        "heading":   v[5] if len(v) > 5 else 0,
                                        "type":      "ship",
                                        "ship_type": "unknown",
                                        "flag":      "",
                                        "status":    "underway",
                                    })
                            if ships:
                                return ships
        except Exception:
            pass
        return []

    def _simulate_movement(self) -> List[dict]:
        for ship in self._ship_state:
            heading_rad = math.radians(ship["heading"])
            speed_knots = ship["speed"]
            d_lat = (speed_knots * 1.852 / 111320) * (60 / 60)
            cos_lat = math.cos(math.radians(ship["latitude"])) or 0.0001
            d_lon = d_lat / cos_lat
            ship["latitude"]  += d_lat * math.cos(heading_rad)
            ship["longitude"] += d_lon * math.sin(heading_rad)
            if ship["longitude"] > 180:  ship["longitude"] -= 360
            if ship["longitude"] < -180: ship["longitude"] += 360
            ship["latitude"] = max(-85, min(85, ship["latitude"]))
            ship["heading"] = (ship["heading"] + random.uniform(-2, 2)) % 360
        return list(self._ship_state)

    def status(self) -> dict:
        confidence = 80 if self._source_mode == "ais_live" else 50
        if self.last_error:
            confidence = max(35, confidence - 15)
        return {
            "name": "ships",
            "source": self._source_mode,
            "running": self._running,
            "count": self.last_count,
            "last_error": self.last_error,
            "confidence": confidence,
        }
