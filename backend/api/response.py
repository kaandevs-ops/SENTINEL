from __future__ import annotations

from typing import Any


def ok(*, data: Any = None, message: str = "ok", meta: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "ok": True,
        "message": message,
        "data": data,
        "meta": meta or {},
    }


def fail(*, message: str, code: str = "bad_request", details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "ok": False,
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
        },
    }


def list_ok(*, rows: list[Any], message: str = "ok", meta: dict[str, Any] | None = None) -> dict[str, Any]:
    payload_meta = {"count": len(rows)}
    if meta:
        payload_meta.update(meta)
    return ok(data=rows, message=message, meta=payload_meta)
