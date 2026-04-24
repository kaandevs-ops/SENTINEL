from fastapi import APIRouter, Depends, HTTPException, Query

from api.deps import get_person_service
from api.deps import get_ops_service
from api.response import list_ok, ok
from services.local_person_service import LocalPersonService, PersonEntity
from services.operational_event_service import OperationalEventService

router = APIRouter()


@router.get("/")
async def list_persons(
    q: str | None = Query(None),
    status: str | None = Query(None),
    risk_level: str | None = Query(None),
    country: str | None = Query(None),
    city: str | None = Query(None),
    limit: int = Query(200, ge=1, le=2000),
    person_service: LocalPersonService = Depends(get_person_service),
):
    rows = await person_service.query_persons(
        q=q,
        status=status,
        risk_level=risk_level,
        country=country,
        city=city,
        limit=limit,
    )
    return list_ok(rows=rows, meta={"filters": {"q": q, "status": status, "risk_level": risk_level, "country": country, "city": city, "limit": limit}})


@router.get("/summary")
async def person_summary(person_service: LocalPersonService = Depends(get_person_service)):
    return ok(data=await person_service.get_summary())


@router.get("/graph")
async def person_graph(person_service: LocalPersonService = Depends(get_person_service)):
    return ok(data=await person_service.get_graph())


@router.post("/")
async def upsert_person(
    payload: PersonEntity,
    person_service: LocalPersonService = Depends(get_person_service),
    ops_service: OperationalEventService = Depends(get_ops_service),
):
    prev = await person_service.get_person(payload.id)
    row = await person_service.upsert_person(payload.model_dump())
    await ops_service.record_event(
        feed="persons",
        severity="info" if prev else "medium",
        status="updated" if prev else "created",
        prev_status="exists" if prev else "none",
        source="local_person_dataset",
        payload={"person_id": row.get("id"), "city": row.get("city"), "country": row.get("country")},
    )
    return ok(data=row, message="person_upserted")


@router.put("/{person_id}")
async def update_person(
    person_id: str,
    payload: PersonEntity,
    person_service: LocalPersonService = Depends(get_person_service),
    ops_service: OperationalEventService = Depends(get_ops_service),
):
    if payload.id != person_id:
        raise HTTPException(status_code=400, detail="Person id mismatch")
    prev = await person_service.get_person(person_id)
    if not prev:
        raise HTTPException(status_code=404, detail="Person not found")
    row = await person_service.upsert_person(payload.model_dump())
    await ops_service.record_event(
        feed="persons",
        severity="info",
        status="updated",
        prev_status=prev.get("status", "unknown"),
        source="local_person_dataset",
        payload={"person_id": row.get("id"), "risk_level": row.get("risk_level"), "status": row.get("status")},
    )
    return ok(data=row, message="person_updated")


@router.delete("/{person_id}")
async def delete_person(
    person_id: str,
    person_service: LocalPersonService = Depends(get_person_service),
    ops_service: OperationalEventService = Depends(get_ops_service),
):
    prev = await person_service.get_person(person_id)
    deleted = await person_service.delete_person(person_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Person not found")
    await ops_service.record_event(
        feed="persons",
        severity="high",
        status="deleted",
        prev_status=prev.get("status", "unknown") if prev else "unknown",
        source="local_person_dataset",
        payload={"person_id": person_id},
    )
    return ok(message="person_deleted")


@router.get("/{person_id}")
async def get_person(person_id: str, person_service: LocalPersonService = Depends(get_person_service)):
    row = await person_service.get_person(person_id)
    if not row:
        raise HTTPException(status_code=404, detail="Person not found")
    return ok(data=row)
