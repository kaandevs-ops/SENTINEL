import asyncio
import logging
from datetime import datetime
from typing import Dict, Optional

from core.collectors.aircraft import AircraftCollector
from core.collectors.satellite import SatelliteCollector
from core.collectors.ships import ShipCollector
from core.collectors.gps_jamming import GpsJammingCollector
from core.collectors.wildfires import WildfireCollector
from core.collectors.cameras import CamerasCollector
from core.collectors.conflicts import ConflictCollector
from core.collectors.cyber_iocs import CyberIocCollector
from core.collectors.events import (
    EarthquakeCollector, WeatherAlertCollector,
    NewsCollector, ThreatCollector,
)

logger = logging.getLogger("sentinel.collector_manager")

RESTART_DELAY = 5


class CollectorManager:
    def __init__(self, cache):
        self.cache = cache
        self._collectors: Dict[str, object] = {
            "aircraft":    AircraftCollector(cache),
            "ships":       ShipCollector(cache),
            "satellites":  SatelliteCollector(cache),
            "earthquakes": EarthquakeCollector(cache),
            "weather":     WeatherAlertCollector(cache),
            "news":        NewsCollector(cache),
            "threats":     ThreatCollector(cache),
            "wildfires":   WildfireCollector(cache),
            "cameras":     CamerasCollector(cache),
            "conflicts":   ConflictCollector(cache),
            "cyber_iocs":  CyberIocCollector(cache),
            "gps_jamming": GpsJammingCollector(cache),
        }
        self._supervisor_tasks: Dict[str, Optional[asyncio.Task]] = {}
        self._crash_counts: Dict[str, int] = {k: 0 for k in self._collectors}
        self._last_restart: Dict[str, Optional[datetime]] = {k: None for k in self._collectors}

    async def start_all(self) -> None:
        for name in self._collectors:
            self._supervisor_tasks[name] = asyncio.create_task(
                self._supervise(name), name=f"supervisor:{name}"
            )

    async def stop_all(self) -> None:
        for task in self._supervisor_tasks.values():
            if task and not task.done():
                task.cancel()
        for collector in self._collectors.values():
            try:
                await collector.stop()
            except Exception:
                pass
        tasks = [t for t in self._supervisor_tasks.values() if t]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _supervise(self, name: str) -> None:
        collector = self._collectors[name]
        while True:
            try:
                logger.info(f"▶️  Starting: {name}")
                await collector.run()
            except asyncio.CancelledError:
                logger.info(f"⏹️  Stopped: {name}")
                return
            except Exception as e:
                self._crash_counts[name] += 1
                self._last_restart[name] = datetime.utcnow()
                logger.error(f"💥 '{name}' crashed #{self._crash_counts[name]}: {e}. Restart in {RESTART_DELAY}s")
                await asyncio.sleep(RESTART_DELAY)

    def status(self) -> Dict:
        result = {}
        for name, collector in self._collectors.items():
            base = collector.status()
            base["crashes"] = self._crash_counts.get(name, 0)
            last = self._last_restart.get(name)
            base["last_restart"] = last.isoformat() if last else None
            task = self._supervisor_tasks.get(name)
            base["supervisor"] = "running" if task and not task.done() else "stopped"
            result[name] = base
        return result
