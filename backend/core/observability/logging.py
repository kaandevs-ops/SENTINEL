from __future__ import annotations

import logging
from typing import Any, Callable, Optional

from core.observability.request_context import get_request_id


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id()
        return True


def setup_logging(*, level: int = logging.INFO) -> None:
    """
    Configure logging with request_id-aware formatter.
    Safe to call multiple times (idempotent-ish).
    """
    # Ensure *all* LogRecords (including uvicorn/sqlalchemy) have request_id.
    old_factory = logging.getLogRecordFactory()

    def record_factory(*args: Any, **kwargs: Any) -> logging.LogRecord:
        record = old_factory(*args, **kwargs)
        if not hasattr(record, "request_id"):
            record.request_id = get_request_id()
        return record

    # Idempotent: don't wrap repeatedly.
    if getattr(old_factory, "_sentinel_wrapped", False) is False:
        setattr(record_factory, "_sentinel_wrapped", True)
        logging.setLogRecordFactory(record_factory)

    root = logging.getLogger()
    root.setLevel(level)

    # Ensure our filter is present on root.
    has_filter = any(isinstance(f, RequestIdFilter) for f in root.filters)
    if not has_filter:
        root.addFilter(RequestIdFilter())

    fmt = "%(asctime)s %(levelname)s %(name)s [rid=%(request_id)s] %(message)s"
    datefmt = "%Y-%m-%dT%H:%M:%S"

    # Attach a handler only if none exist (uvicorn may preconfigure handlers).
    if not root.handlers:
        handler = logging.StreamHandler()
        handler.setLevel(level)
        handler.setFormatter(logging.Formatter(fmt=fmt, datefmt=datefmt))
        root.addHandler(handler)
        return

    # Update existing handlers' formatter to include request_id (best-effort).
    for h in root.handlers:
        try:
            h.setLevel(level)
            h.setFormatter(logging.Formatter(fmt=fmt, datefmt=datefmt))
        except Exception:
            continue

