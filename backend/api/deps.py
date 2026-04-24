from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import Request

if TYPE_CHECKING:
    from services.alert_service import AlertService
    from services.cache_service import CacheService
    from core.ai.orchestrator import AIOrchestrator
    from services.operational_event_service import OperationalEventService
    from services.local_person_service import LocalPersonService


def get_cache(request: Request) -> "CacheService":
    return request.app.state.cache


def get_alert_service(request: Request) -> "AlertService":
    return request.app.state.alert_service


def get_ai_orchestrator(request: Request) -> "AIOrchestrator":
    return request.app.state.ai_orchestrator


def get_ops_service(request: Request) -> "OperationalEventService":
    return request.app.state.ops_service


def get_person_service(request: Request) -> "LocalPersonService":
    return request.app.state.person_service

