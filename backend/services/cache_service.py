import asyncio
import json
import logging
from collections import defaultdict
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict, List, Optional, Set

logger = logging.getLogger("sentinel.cache")

class CacheService:
    def __init__(self):
        self._redis = None
        self._pubsub = None
        self._listener_task: Optional[asyncio.Task] = None
        self._redis_channels: Set[str] = set()
        self._memory: Dict[str, Any] = {}
        self._subscribers: Dict[str, List[Callable[[dict], Awaitable[None]]]] = defaultdict(list)
        self._use_redis = False

    async def connect(self):
        from core.config import settings
        try:
            import redis.asyncio as aioredis
            self._redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            await self._redis.ping()
            self._use_redis = True
            self._pubsub = self._redis.pubsub(ignore_subscribe_messages=True)
            self._listener_task = asyncio.create_task(self._listen_redis_pubsub(), name="cache:redis-pubsub")
            logger.info("✅ Redis connected")
        except Exception:
            logger.warning("⚠️  Redis unavailable — using in-memory cache")
            self._use_redis = False

    async def disconnect(self):
        if self._listener_task and not self._listener_task.done():
            self._listener_task.cancel()
            await asyncio.gather(self._listener_task, return_exceptions=True)
        self._listener_task = None
        self._redis_channels.clear()
        if self._pubsub:
            try:
                await self._pubsub.close()
            except Exception:
                pass
        self._pubsub = None
        if self._redis:
            await self._redis.close()

    async def ping(self) -> dict:
        return {"mode": "redis" if self._use_redis else "memory"}

    async def set(self, key: str, value: Any, ttl: int = 300):
        payload = json.dumps(value, default=str)
        if self._use_redis:
            await self._redis.setex(key, ttl, payload)
        else:
            self._memory[key] = payload

    async def get(self, key: str) -> Optional[Any]:
        if self._use_redis:
            raw = await self._redis.get(key)
        else:
            raw = self._memory.get(key)
        return json.loads(raw) if raw else None

    async def delete(self, key: str):
        if self._use_redis:
            await self._redis.delete(key)
        else:
            self._memory.pop(key, None)

    async def publish(self, channel: str, data: Any):
        payload = json.dumps(data, default=str)
        # Always dispatch to local subscribers (same-process).
        await self._dispatch_local(channel, payload)
        if self._use_redis:
            await self._redis.publish(channel, payload)

    def subscribe(self, channel: str, callback: Callable[[dict], Awaitable[None]]):
        self._subscribers[channel].append(callback)
        # If Redis is active, subscribe at the broker too.
        if self._use_redis and self._pubsub and channel not in self._redis_channels:
            self._redis_channels.add(channel)
            asyncio.create_task(self._pubsub.subscribe(channel), name=f"cache:subscribe:{channel}")

    def unsubscribe(self, channel: str, callback: Callable[[dict], Awaitable[None]]):
        self._subscribers[channel] = [cb for cb in self._subscribers[channel] if cb != callback]
        if not self._subscribers[channel]:
            self._subscribers.pop(channel, None)
            if self._use_redis and self._pubsub and channel in self._redis_channels:
                self._redis_channels.discard(channel)
                asyncio.create_task(self._pubsub.unsubscribe(channel), name=f"cache:unsubscribe:{channel}")

    async def _dispatch_local(self, channel: str, payload: str) -> None:
        msg = json.loads(payload)
        for cb in list(self._subscribers.get(channel, [])):
            try:
                await cb(msg)
            except Exception as e:
                logger.error(f"Subscriber error on {channel}: {e}")

    async def _listen_redis_pubsub(self) -> None:
        if not self._pubsub:
            return
        try:
            async for message in self._pubsub.listen():
                if not isinstance(message, dict):
                    continue
                if message.get("type") != "message":
                    continue
                channel = message.get("channel")
                data = message.get("data")
                if not isinstance(channel, str) or not isinstance(data, str):
                    continue
                await self._dispatch_local(channel, data)
        except asyncio.CancelledError:
            return
        except Exception as e:
            # Non-fatal: we can still operate in-memory; Redis listener will stop though.
            logger.warning(f"Redis pubsub listener stopped: {e}")

    async def store_aircraft(self, data: List[dict]):
        # OpenSky can rate-limit; keep last known state longer to avoid UI dropping to 0.
        await self.set("live:aircraft", data, ttl=300)
        await self.publish("stream:aircraft", {"type": "aircraft_update", "data": data, "ts": datetime.utcnow().isoformat()})

    async def store_ships(self, data: List[dict]):
        await self.set("live:ships", data, ttl=120)
        await self.publish("stream:ships", {"type": "ship_update", "data": data, "ts": datetime.utcnow().isoformat()})

    async def store_satellites(self, data: List[dict]):
        await self.set("live:satellites", data, ttl=60)
        await self.publish("stream:satellites", {"type": "satellite_update", "data": data, "ts": datetime.utcnow().isoformat()})

    async def store_earthquakes(self, data: List[dict]):
        await self.set("live:earthquakes", data, ttl=300)
        await self.publish("stream:events", {"type": "earthquake_update", "data": data, "ts": datetime.utcnow().isoformat()})

    async def store_weather_alerts(self, data: List[dict]):
        await self.set("live:weather_alerts", data, ttl=600)
        await self.publish("stream:events", {"type": "weather_update", "data": data, "ts": datetime.utcnow().isoformat()})

    async def store_news(self, data: List[dict]):
        await self.set("live:news", data, ttl=600)
        await self.publish("stream:news", {"type": "news_update", "data": data, "ts": datetime.utcnow().isoformat()})

    async def store_gps_jamming(self, data: List[dict]):
        await self.set("live:gps_jamming", data, ttl=120)
        await self.publish("stream:gps_jamming", {"type": "gps_jamming_update", "data": data, "ts": datetime.utcnow().isoformat()})

    async def store_threats(self, data: List[dict]):
        await self.set("live:threats", data, ttl=300)
        await self.publish("stream:threats", {"type": "threat_update", "data": data, "ts": datetime.utcnow().isoformat()})

    async def store_wildfires(self, data: List[dict]):
        await self.set("live:wildfires", data, ttl=600)
        await self.publish("stream:wildfires", {"type": "wildfires_update", "data": data, "ts": datetime.utcnow().isoformat()})

    async def store_cameras(self, data: List[dict]):
        await self.set("live:cameras", data, ttl=1800)
        await self.publish("stream:cameras", {"type": "cameras_update", "data": data, "ts": datetime.utcnow().isoformat()})

    async def store_conflicts(self, data: List[dict]):
        await self.set("live:conflicts", data, ttl=600)
        await self.publish("stream:conflicts", {"type": "conflicts_update", "data": data, "ts": datetime.utcnow().isoformat()})

    async def store_cyber_iocs(self, data: List[dict]):
        await self.set("live:cyber_iocs", data, ttl=1200)
        await self.publish("stream:cyber_iocs", {"type": "cyber_iocs_update", "data": data, "ts": datetime.utcnow().isoformat()})

    async def store_persons(self, data: List[dict]):
        await self.set("live:persons", data, ttl=86400)
        await self.publish("stream:persons", {"type": "person_update", "data": data, "ts": datetime.utcnow().isoformat()})

    async def get_all_live(self) -> dict:
        return {
            "aircraft":       await self.get("live:aircraft") or [],
            "ships":          await self.get("live:ships") or [],
            "satellites":     await self.get("live:satellites") or [],
            "earthquakes":    await self.get("live:earthquakes") or [],
            "weather_alerts": await self.get("live:weather_alerts") or [],
            "news":           await self.get("live:news") or [],
            "threats":        await self.get("live:threats") or [],
            "wildfires":      await self.get("live:wildfires") or [],
            "cameras":        await self.get("live:cameras") or [],
            "conflicts":      await self.get("live:conflicts") or [],
            "cyber_iocs":     await self.get("live:cyber_iocs") or [],
            "gps_jamming":    await self.get("live:gps_jamming") or [],
            "persons":        await self.get("live:persons") or [],
        }
