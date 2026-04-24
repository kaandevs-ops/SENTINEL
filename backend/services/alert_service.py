import logging
import asyncio
from datetime import datetime
from typing import Any, Dict, List, Optional, TypedDict

logger = logging.getLogger("sentinel.alerts")


class Alert(TypedDict, total=False):
    id: str
    type: str
    threat_level: str
    title: str
    description: str
    anomalies: List[Any]
    latitude: Optional[float]
    longitude: Optional[float]
    is_active: bool
    is_read: bool
    created_at: str
    resolved_at: str


class AlertService:
    def __init__(self, cache: Any):
        self.cache = cache
        self._alerts: List[Alert] = []
        self._id_counter = 0
        self._lock = asyncio.Lock()

    def _next_id(self) -> str:
        self._id_counter += 1
        return f"ALT-{self._id_counter:05d}"

    async def create_ai_alert(
        self,
        title: str,
        description: str,
        threat_level: str = "medium",
        anomalies: Optional[list] = None,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
    ) -> Alert:
        alert: Alert = {
            "id": self._next_id(),
            "type": "ai_insight",
            "threat_level": threat_level,
            "title": title,
            "description": description,
            "anomalies": anomalies or [],
            "latitude": latitude,
            "longitude": longitude,
            "is_active": True,
            "is_read": False,
            "created_at": datetime.utcnow().isoformat(),
        }
        async with self._lock:
            self._alerts.insert(0, alert)
            if len(self._alerts) > 500:
                self._alerts = self._alerts[:500]
        await self.cache.publish("stream:alerts", {"type": "new_alert", "alert": alert})
        logger.info(f"🚨 Alert: [{threat_level.upper()}] {title}")
        return alert

    async def list_alerts(
        self,
        *,
        active_only: bool = True,
        unread_only: bool = False,
        limit: int = 200,
    ) -> List[Alert]:
        async with self._lock:
            alerts = list(self._alerts)
        if active_only:
            alerts = [a for a in alerts if a.get("is_active")]
        if unread_only:
            alerts = [a for a in alerts if not a.get("is_read")]
        return alerts[:limit]

    async def get_active_alerts(self) -> List[Alert]:
        return await self.list_alerts(active_only=True, unread_only=False, limit=500)

    async def get_stats(self) -> Dict[str, Any]:
        async with self._lock:
            all_alerts = list(self._alerts)
        active = [a for a in all_alerts if a.get("is_active")]
        unread = [a for a in active if not a.get("is_read")]
        by_level: Dict[str, int] = {}
        for a in active:
            lvl = a.get("threat_level", "unknown")
            by_level[lvl] = by_level.get(lvl, 0) + 1
        return {
            "total": len(all_alerts),
            "active": len(active),
            "unread": len(unread),
            "by_threat_level": by_level,
        }

    async def mark_read(self, alert_id: str):
        async with self._lock:
            for a in self._alerts:
                if a.get("id") == alert_id:
                    a["is_read"] = True

    async def resolve(self, alert_id: str):
        async with self._lock:
            for a in self._alerts:
                if a.get("id") == alert_id:
                    a["is_active"] = False
                    a["resolved_at"] = datetime.utcnow().isoformat()
