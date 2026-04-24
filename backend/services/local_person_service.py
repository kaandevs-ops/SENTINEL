from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field, field_validator


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class PersonEntity(BaseModel):
    id: str = Field(min_length=3, max_length=64)
    full_name: str = Field(min_length=2, max_length=120)
    nickname: str = Field(default="", max_length=64)
    role: str = Field(default="analyst", max_length=64)
    status: str = Field(default="active", max_length=32)
    risk_level: str = Field(default="low", max_length=16)
    country: str = Field(default="Unknown", max_length=8)
    city: str = Field(default="Unknown", max_length=96)
    latitude: float
    longitude: float
    phone: str = Field(default="", max_length=64)
    email: str = Field(default="", max_length=128)
    skills: list[str] = Field(default_factory=list)
    notes: str = Field(default="", max_length=500)
    last_seen: str = Field(default_factory=_utc_now_iso)

    @field_validator("latitude")
    @classmethod
    def _validate_latitude(cls, value: float) -> float:
        if not -90 <= value <= 90:
            raise ValueError("latitude must be between -90 and 90")
        return value

    @field_validator("longitude")
    @classmethod
    def _validate_longitude(cls, value: float) -> float:
        if not -180 <= value <= 180:
            raise ValueError("longitude must be between -180 and 180")
        return value


@dataclass
class PersonDataset:
    data_version: int
    updated_at: str
    persons: list[PersonEntity]


class LocalPersonService:
    def __init__(self, cache: Any, data_file: Path | None = None):
        self.cache = cache
        self._lock = asyncio.Lock()
        self.data_file = data_file or Path(__file__).resolve().parents[1] / "data" / "person_entities.json"
        self._dataset = PersonDataset(data_version=1, updated_at=_utc_now_iso(), persons=[])

    async def initialize(self) -> None:
        await self._load_from_disk()
        await self._sync_cache()

    async def list_persons(self) -> list[dict[str, Any]]:
        async with self._lock:
            return [p.model_dump() for p in self._dataset.persons]

    async def query_persons(
        self,
        *,
        q: str | None = None,
        status: str | None = None,
        risk_level: str | None = None,
        country: str | None = None,
        city: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        rows = await self.list_persons()
        text = (q or "").strip().lower()
        out: list[dict[str, Any]] = []
        for row in rows:
            if status and str(row.get("status", "")).lower() != status.lower():
                continue
            if risk_level and str(row.get("risk_level", "")).lower() != risk_level.lower():
                continue
            if country and str(row.get("country", "")).lower() != country.lower():
                continue
            if city and str(row.get("city", "")).lower() != city.lower():
                continue
            if text:
                searchable = " ".join(
                    [
                        str(row.get("id", "")),
                        str(row.get("full_name", "")),
                        str(row.get("nickname", "")),
                        str(row.get("role", "")),
                        str(row.get("city", "")),
                        str(row.get("country", "")),
                        " ".join(row.get("skills", [])),
                    ]
                ).lower()
                if text not in searchable:
                    continue
            out.append(row)
        return out[: max(1, min(limit, 2000))]

    async def get_person(self, person_id: str) -> dict[str, Any] | None:
        async with self._lock:
            for p in self._dataset.persons:
                if p.id == person_id:
                    return p.model_dump()
        return None

    async def upsert_person(self, payload: dict[str, Any]) -> dict[str, Any]:
        person = PersonEntity(**payload)
        async with self._lock:
            idx = next((i for i, p in enumerate(self._dataset.persons) if p.id == person.id), None)
            if idx is None:
                self._dataset.persons.insert(0, person)
            else:
                self._dataset.persons[idx] = person
            self._dataset.updated_at = _utc_now_iso()
            await self._persist_locked()
            result = person.model_dump()
        await self._sync_cache()
        return result

    async def delete_person(self, person_id: str) -> bool:
        deleted = False
        async with self._lock:
            before = len(self._dataset.persons)
            self._dataset.persons = [p for p in self._dataset.persons if p.id != person_id]
            deleted = len(self._dataset.persons) != before
            if deleted:
                self._dataset.updated_at = _utc_now_iso()
                await self._persist_locked()
        if deleted:
            await self._sync_cache()
        return deleted

    async def get_summary(self) -> dict[str, Any]:
        rows = await self.list_persons()
        by_status: dict[str, int] = {}
        by_risk: dict[str, int] = {}
        by_country: dict[str, int] = {}
        for row in rows:
            s = str(row.get("status", "unknown")).lower()
            r = str(row.get("risk_level", "low")).lower()
            c = str(row.get("country", "unknown")).upper()
            by_status[s] = by_status.get(s, 0) + 1
            by_risk[r] = by_risk.get(r, 0) + 1
            by_country[c] = by_country.get(c, 0) + 1
        top_countries = sorted(by_country.items(), key=lambda x: x[1], reverse=True)[:8]
        return {
            "count": len(rows),
            "by_status": by_status,
            "by_risk": by_risk,
            "top_countries": [{"country": c, "count": n} for c, n in top_countries],
        }

    async def get_graph(self) -> dict[str, Any]:
        rows = await self.list_persons()
        nodes = []
        edges = []
        for row in rows:
            pid = row["id"]
            nodes.append(
                {
                    "id": pid,
                    "label": row.get("full_name") or pid,
                    "role": row.get("role"),
                    "risk_level": row.get("risk_level", "low"),
                    "country": row.get("country", "Unknown"),
                }
            )
        for i in range(len(rows)):
            a = rows[i]
            a_skills = set(a.get("skills", []))
            for j in range(i + 1, len(rows)):
                b = rows[j]
                score = 0
                reasons = []
                if (a.get("country") or "").lower() == (b.get("country") or "").lower():
                    score += 1
                    reasons.append("same_country")
                if (a.get("city") or "").lower() == (b.get("city") or "").lower():
                    score += 1
                    reasons.append("same_city")
                common_skills = sorted(a_skills.intersection(set(b.get("skills", []))))
                if common_skills:
                    score += min(2, len(common_skills))
                    reasons.append(f"shared_skills:{','.join(common_skills[:3])}")
                if score > 0:
                    edges.append(
                        {
                            "source": a["id"],
                            "target": b["id"],
                            "weight": score,
                            "reasons": reasons,
                        }
                    )
        return {"nodes": nodes, "edges": edges}

    async def _load_from_disk(self) -> None:
        if not self.data_file.exists():
            self.data_file.parent.mkdir(parents=True, exist_ok=True)
            await self._persist_locked()
            return
        try:
            raw = json.loads(self.data_file.read_text(encoding="utf-8"))
            persons = [PersonEntity(**p) for p in raw.get("persons", [])]
            self._dataset = PersonDataset(
                data_version=int(raw.get("data_version", 1)),
                updated_at=str(raw.get("updated_at") or _utc_now_iso()),
                persons=persons,
            )
        except Exception:
            # Keep service alive even with malformed local files.
            self._dataset = PersonDataset(data_version=1, updated_at=_utc_now_iso(), persons=[])

    async def _persist_locked(self) -> None:
        self.data_file.parent.mkdir(parents=True, exist_ok=True)
        doc = {
            "data_version": self._dataset.data_version,
            "updated_at": self._dataset.updated_at,
            "persons": [p.model_dump() for p in self._dataset.persons],
        }
        self.data_file.write_text(json.dumps(doc, indent=2), encoding="utf-8")

    async def _sync_cache(self) -> None:
        rows = await self.list_persons()
        await self.cache.set("live:persons", rows, ttl=86400)
        await self.cache.publish(
            "stream:persons",
            {"type": "person_update", "data": rows, "ts": _utc_now_iso()},
        )
