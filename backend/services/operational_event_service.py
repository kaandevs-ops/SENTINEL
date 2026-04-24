import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import desc, select

from db.database import AsyncSessionLocal, OperationalEvent

logger = logging.getLogger("sentinel.ops")


class OperationalEventService:
    def __init__(self, cache: Any, collector_manager: Any, *, poll_interval_sec: int = 15, max_events: int = 300):
        self._cache = cache
        self._collector_manager = collector_manager
        self._poll_interval_sec = poll_interval_sec
        self._max_events = max_events
        self._events: List[dict] = []
        self._last_status: Dict[str, dict] = {}
        self._task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._task = asyncio.create_task(self._run(), name="ops:watcher")

    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
        self._task = None

    def get_events(self, limit: int = 50) -> List[dict]:
        return list(self._events[: max(1, limit)])

    def snapshot(self) -> Dict[str, dict]:
        return dict(self._last_status)

    async def record_event(
        self,
        *,
        feed: str,
        severity: str,
        status: str,
        prev_status: str = "unknown",
        source: str = "manual",
        confidence: int | None = None,
        last_error: str | None = None,
        payload: dict | None = None,
    ) -> dict:
        now_iso = datetime.now(timezone.utc).isoformat()
        event = {
            "id": f"{feed}:{int(datetime.now(timezone.utc).timestamp() * 1000)}",
            "feed": feed,
            "ts": now_iso,
            "severity": severity,
            "status": status,
            "prev_status": prev_status,
            "source": source,
            "confidence": confidence,
            "last_error": last_error,
            "payload": payload or {},
        }
        self._events.insert(0, event)
        self._events = self._events[: self._max_events]
        await self._cache.publish("stream:ops", {"type": "ops_event", "event": event})
        await self._persist_event(event)
        return event

    async def _run(self) -> None:
        while True:
            try:
                statuses = self._collector_manager.status()
                now_iso = datetime.now(timezone.utc).isoformat()
                for feed, raw in statuses.items():
                    normalized = self._normalize_status(raw)
                    prev = self._last_status.get(feed)
                    self._last_status[feed] = normalized
                    if prev is None:
                        continue

                    changed = (
                        prev.get("status") != normalized.get("status")
                        or prev.get("source") != normalized.get("source")
                        or abs((prev.get("confidence") or 0) - (normalized.get("confidence") or 0)) >= 15
                    )
                    if not changed:
                        continue

                    event = {
                        "id": f"{feed}:{int(datetime.now(timezone.utc).timestamp() * 1000)}",
                        "feed": feed,
                        "ts": now_iso,
                        "severity": self._compute_severity(normalized),
                        "status": normalized.get("status", "unknown"),
                        "prev_status": prev.get("status", "unknown"),
                        "source": normalized.get("source", "n/a"),
                        "confidence": normalized.get("confidence"),
                        "last_error": normalized.get("last_error"),
                    }
                    self._events.insert(0, event)
                    self._events = self._events[: self._max_events]
                    await self._cache.publish("stream:ops", {"type": "ops_event", "event": event})
                    await self._persist_event(event)
            except asyncio.CancelledError:
                return
            except Exception as e:
                logger.warning(f"Operational watcher error: {e}")

            await asyncio.sleep(self._poll_interval_sec)

    def _normalize_status(self, raw: dict) -> dict:
        last_fetch = raw.get("last_fetch")
        last_error = raw.get("last_error")
        confidence = raw.get("confidence")

        status = "healthy"
        if not last_fetch:
            status = "stale"
        elif last_error == "rate_limited":
            status = "degraded"
        elif last_error:
            status = "degraded"

        return {
            "status": status,
            "source": raw.get("source", "n/a"),
            "confidence": confidence if isinstance(confidence, int) else None,
            "last_error": last_error,
            "last_fetch": last_fetch,
        }

    def _compute_severity(self, normalized: dict) -> str:
        status = normalized.get("status")
        confidence = normalized.get("confidence")
        if status == "stale":
            return "high"
        if status == "degraded":
            return "medium"
        if isinstance(confidence, int) and confidence < 55:
            return "medium"
        return "info"

    async def _persist_event(self, event: dict) -> None:
        try:
            async with AsyncSessionLocal() as session:
                row = OperationalEvent(
                    event_id=event.get("id"),
                    feed=event.get("feed", "unknown"),
                    severity=event.get("severity", "info"),
                    status=event.get("status", "unknown"),
                    prev_status=event.get("prev_status", "unknown"),
                    source=event.get("source"),
                    confidence=event.get("confidence"),
                    last_error=event.get("last_error"),
                    occurred_at=datetime.fromisoformat(event.get("ts").replace("Z", "+00:00")),
                    payload=event,
                )
                session.add(row)
                await session.commit()
        except Exception as e:
            logger.warning(f"Operational event persist skipped: {e}")

    async def get_persisted_events(
        self,
        *,
        limit: int = 100,
        feed: Optional[str] = None,
        severity: Optional[str] = None,
        from_ts: Optional[str] = None,
        to_ts: Optional[str] = None,
    ) -> List[dict]:
        async with AsyncSessionLocal() as session:
            stmt = select(OperationalEvent)
            if feed:
                stmt = stmt.where(OperationalEvent.feed == feed)
            if severity:
                stmt = stmt.where(OperationalEvent.severity == severity)
            if from_ts:
                try:
                    from_dt = datetime.fromisoformat(from_ts.replace("Z", "+00:00"))
                    stmt = stmt.where(OperationalEvent.occurred_at >= from_dt)
                except Exception:
                    pass
            if to_ts:
                try:
                    to_dt = datetime.fromisoformat(to_ts.replace("Z", "+00:00"))
                    stmt = stmt.where(OperationalEvent.occurred_at <= to_dt)
                except Exception:
                    pass
            stmt = stmt.order_by(desc(OperationalEvent.occurred_at)).limit(max(1, min(limit, 500)))
            rows = (await session.execute(stmt)).scalars().all()
            return [
                {
                    "id": r.event_id,
                    "feed": r.feed,
                    "severity": r.severity,
                    "status": r.status,
                    "prev_status": r.prev_status,
                    "source": r.source,
                    "confidence": r.confidence,
                    "last_error": r.last_error,
                    "ts": r.occurred_at.isoformat() if r.occurred_at else None,
                }
                for r in rows
            ]

