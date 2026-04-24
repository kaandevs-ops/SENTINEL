import asyncio, logging, math
from datetime import datetime, timezone
from typing import List, Optional
import aiohttp

logger = logging.getLogger("sentinel.collectors.satellite")

def _generate_sats() -> List[dict]:
    sats = [
        {"name":"ISS (ZARYA)","norad":"25544","inclination":51.6,"mean_motion":15.49,"raan":0.0},
        {"name":"SENTINEL-2A","norad":"40697","inclination":98.6,"mean_motion":14.31,"raan":90.0},
        {"name":"TERRA","norad":"25994","inclination":98.2,"mean_motion":14.57,"raan":135.0},
        {"name":"AQUA","norad":"27424","inclination":98.2,"mean_motion":14.57,"raan":180.0},
        {"name":"LANDSAT-8","norad":"39084","inclination":98.2,"mean_motion":14.57,"raan":300.0},
    ]
    for i in range(150):
        sats.append({"name":f"STARLINK-{1000+i}","norad":str(44713+i),"inclination":53.0+(i%6)*0.5,"mean_motion":15.05+(i%10)*0.01,"raan":(i*2.4)%360})
    for i in range(30):
        sats.append({"name":f"GPS-SVN-{i+1}","norad":str(24876+i*10),"inclination":55.0+(i%4)*0.5,"mean_motion":2.005+(i%5)*0.001,"raan":(i*12)%360})
    for i in range(50):
        sats.append({"name":f"SAT-{20000+i*100}","norad":str(20000+i*100),"inclination":97.0+(i%5)*0.4,"mean_motion":14.2+(i%8)*0.05,"raan":(i*7.2)%360})
    for i in range(30):
        sats.append({"name":f"COSMOS-{2000+i}","norad":str(39000+i*5),"inclination":64.8+(i%3)*2.0,"mean_motion":14.0+(i%6)*0.1,"raan":(i*11)%360})
    return sats[:300]

class SatelliteCollector:
    def __init__(self, cache):
        self.cache = cache
        self._running = False
        self.last_count = 0
        self.last_error: Optional[str] = None
        self.last_fetch: Optional[datetime] = None
        self._sats: List[dict] = []
        self._source_mode = "fallback"

    async def run(self) -> None:
        self._running = True
        logger.info("🛰️  Satellite collector started")
        tle_refresh = 0
        try:
            while self._running:
                try:
                    if tle_refresh == 0:
                        fetched = await self._fetch_sats()
                        if fetched:
                            self._sats = fetched[:300]
                            self._source_mode = "celestrak"
                        else:
                            self._sats = _generate_sats()
                            self._source_mode = "fallback"
                        self.last_fetch = datetime.now(timezone.utc)
                        logger.info(f"🛰️  Loaded {len(self._sats)} satellites ({self._source_mode})")
                    positions = self._compute_positions()
                    if positions:
                        await self.cache.store_satellites(positions)
                        self.last_count = len(positions)
                    tle_refresh = (tle_refresh + 1) % 120
                except Exception as e:
                    self.last_error = str(e)
                    logger.error(f"Satellite error: {e}")
                await asyncio.sleep(30)
        finally:
            self._running = False

    async def stop(self) -> None:
        self._running = False

    async def _fetch_sats(self) -> List[dict]:
        url = "https://celestrak.org/SOCRATES/query.php?GROUP=active&FORMAT=json"
        timeout = aiohttp.ClientTimeout(total=30)
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url) as resp:
                    if resp.status == 200:
                        data = await resp.json(content_type=None)
                        if isinstance(data, list) and data:
                            result = []
                            for s in data[:300]:
                                try:
                                    result.append({
                                        "name": s.get("OBJECT_NAME","UNKNOWN"),
                                        "norad": str(s.get("NORAD_CAT_ID","")),
                                        "inclination": float(s.get("INCLINATION",0)),
                                        "mean_motion": float(s.get("MEAN_MOTION",14)),
                                        "raan": float(s.get("RA_OF_ASC_NODE",0)),
                                        "object_type": s.get("OBJECT_TYPE","PAYLOAD"),
                                    })
                                except Exception:
                                    continue
                            return result
        except Exception as e:
            logger.warning(f"CelesTrak fetch failed: {e}")
        return []

    def _compute_positions(self) -> List[dict]:
        results = []
        now = datetime.now(timezone.utc)
        minutes_now = now.hour * 60 + now.minute + now.second / 60.0
        for sat in self._sats:
            try:
                inc = sat["inclination"]
                mm = sat["mean_motion"]
                raan = sat.get("raan", 0)
                if mm <= 0:
                    continue
                period_min = 1440.0 / mm
                angle = (minutes_now / period_min * 360) % 360
                rad_a = math.radians(angle)
                rad_i = math.radians(inc)
                rad_r = math.radians(raan)
                x = math.cos(rad_r)*math.cos(rad_a) - math.sin(rad_r)*math.sin(rad_a)*math.cos(rad_i)
                y = math.sin(rad_r)*math.cos(rad_a) + math.cos(rad_r)*math.sin(rad_a)*math.cos(rad_i)
                z = math.sin(rad_a)*math.sin(rad_i)
                lat = math.degrees(math.asin(max(-1, min(1, z))))
                lon = math.degrees(math.atan2(y, x))
                earth_rot = (minutes_now / (24*60)) * 360
                lon = ((lon - earth_rot) + 180) % 360 - 180
                mu = 398600.4418
                n_rad = mm * 2 * math.pi / 86400
                a = (mu / (n_rad**2))**(1/3)
                alt = max(a - 6371, 160)
                trail = self._compute_trail(sat, minutes_now, period_min, rad_i, rad_r)
                name_up = sat["name"].upper()
                if any(x in name_up for x in ["STARLINK","ONEWEB","IRIDIUM"]):
                    otype = "constellation"
                elif any(x in name_up for x in ["GPS","GLONASS","GALILEO","BEIDOU"]):
                    otype = "navigation"
                elif any(x in name_up for x in ["DEB","DEBRIS","R/B","ROCKET","COSMOS"]):
                    otype = "debris"
                elif any(x in name_up for x in ["ISS","CSS","STATION"]):
                    otype = "station"
                else:
                    otype = sat.get("object_type","payload").lower()
                results.append({
                    "id": f"SAT-{sat['norad']}",
                    "name": sat["name"],
                    "norad_id": sat["norad"],
                    "latitude": round(lat, 4),
                    "longitude": round(lon, 4),
                    "altitude": round(alt, 1),
                    "inclination": inc,
                    "period_min": round(period_min, 1),
                    "raan": round(raan, 2),
                    "object_type": otype,
                    "trail": trail,
                    "type": "satellite",
                })
            except Exception:
                continue
        return results

    def _compute_trail(self, sat, minutes_now, period_min, rad_i, rad_r) -> List[dict]:
        trail = []
        trail_dur = period_min * 0.25
        for i in range(20):
            t = minutes_now - trail_dur * (1 - i/19)
            a = (t / period_min * 360) % 360
            ra = math.radians(a)
            x = math.cos(rad_r)*math.cos(ra) - math.sin(rad_r)*math.sin(ra)*math.cos(rad_i)
            y = math.sin(rad_r)*math.cos(ra) + math.cos(rad_r)*math.sin(ra)*math.cos(rad_i)
            z = math.sin(ra)*math.sin(rad_i)
            p_lat = math.degrees(math.asin(max(-1, min(1, z))))
            p_lon = math.degrees(math.atan2(y, x))
            er = (t / (24*60)) * 360
            p_lon = ((p_lon - er) + 180) % 360 - 180
            trail.append({"lat": round(p_lat, 3), "lon": round(p_lon, 3)})
        return trail

    def status(self) -> dict:
        confidence = 85 if self._source_mode == "celestrak" else 60
        if self.last_error:
            confidence = max(35, confidence - 15)
        return {
            "name": "satellites",
            "source": self._source_mode,
            "running": self._running,
            "count": self.last_count,
            "last_fetch": self.last_fetch.isoformat() if self.last_fetch else None,
            "last_error": self.last_error,
            "confidence": confidence,
        }
