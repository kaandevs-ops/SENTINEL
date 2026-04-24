from fastapi import APIRouter, Depends, Query
from typing import Optional

from api.deps import get_alert_service
from api.response import list_ok, ok
from services.alert_service import AlertService

router = APIRouter()


@router.get("/")
async def get_alerts(
    active_only: bool = Query(True),
    unread_only: bool = Query(False),
    limit: int = Query(50, le=200),
    alert_service: AlertService = Depends(get_alert_service),
):
    alerts = await alert_service.list_alerts(
        active_only=active_only,
        unread_only=unread_only,
        limit=limit,
    )
    rows = alerts[:limit]
    return list_ok(rows=rows, meta={"active_only": active_only, "unread_only": unread_only, "limit": limit})


@router.get("/stats")
async def get_alert_stats(alert_service: AlertService = Depends(get_alert_service)):
    return ok(data=await alert_service.get_stats())


@router.post("/{alert_id}/read")
async def mark_read(
    alert_id: str,
    alert_service: AlertService = Depends(get_alert_service),
):
    await alert_service.mark_read(alert_id)
    return ok(message="alert_marked_read")


@router.post("/{alert_id}/resolve")
async def resolve_alert(
    alert_id: str,
    alert_service: AlertService = Depends(get_alert_service),
):
    await alert_service.resolve(alert_id)
    return ok(message="alert_resolved")
