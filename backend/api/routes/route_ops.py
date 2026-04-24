from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends

from api.deps import get_cache
from services.cache_service import CacheService
from services.route_ops_service import analyze_route_ops

router = APIRouter()


class RouteOpsRequest(BaseModel):
    start_lat: float = Field(..., ge=-90, le=90)
    start_lon: float = Field(..., ge=-180, le=180)
    end_lat: float = Field(..., ge=-90, le=90)
    end_lon: float = Field(..., ge=-180, le=180)
    corridor_km: float = Field(default=180.0, ge=20.0, le=1000.0)


@router.post("/analyze")
async def analyze_route(
    body: RouteOpsRequest,
    cache: CacheService = Depends(get_cache),
):
    data = await analyze_route_ops(
        cache=cache,
        start_lat=body.start_lat,
        start_lon=body.start_lon,
        end_lat=body.end_lat,
        end_lon=body.end_lon,
        corridor_km=body.corridor_km,
    )
    return {"ok": True, "data": data}
