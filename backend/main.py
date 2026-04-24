import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from core.config import settings
from core.middleware.request_id import RequestIdMiddleware
from core.observability.logging import setup_logging
from core.observability.request_context import get_request_id
from db.database import init_db
from services.cache_service import CacheService
from services.collector_manager import CollectorManager
from services.alert_service import AlertService
from services.operational_event_service import OperationalEventService
from services.local_person_service import LocalPersonService
from core.ai.orchestrator import AIOrchestrator
from api.response import ok
from api.routes import ai_config
from api.routes import entities, events, alerts, intelligence
from api.routes import websocket_router
from api.routes import geoseer
from api.routes import route_ops
from api.routes import persons
from api.routes import playback as playback_router
from services.snapshot_service import SnapshotService

setup_logging(level=logging.INFO)
logger = logging.getLogger("sentinel")

cache = CacheService()
collector_manager = CollectorManager(cache)
alert_service = AlertService(cache)
ops_service = OperationalEventService(cache, collector_manager)
ai_orchestrator = AIOrchestrator(cache=cache, alert_service=alert_service, ops_service=ops_service)
person_service = LocalPersonService(cache)

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🛡️  SENTINEL starting...")
    # Expose core singletons via app.state to avoid circular imports in routers/services.
    app.state.cache = cache
    app.state.collector_manager = collector_manager
    app.state.alert_service = alert_service
    app.state.ai_orchestrator = ai_orchestrator
    app.state.ops_service = ops_service
    app.state.person_service = person_service
    await init_db()
    await cache.connect()
    await person_service.initialize()
    await collector_manager.start_all()
    await ai_orchestrator.start()
    await ops_service.start()
    snapshot_service = SnapshotService(cache)
    app.state.snapshot_service = snapshot_service
    await snapshot_service.start()
    logger.info("✅ All systems online")
    yield
    logger.info("🔴 SENTINEL shutting down...")
    await app.state.snapshot_service.stop()
    await ops_service.stop()
    await ai_orchestrator.stop()
    await collector_manager.stop_all()
    await cache.disconnect()

app = FastAPI(title="SENTINEL", version="1.0.0", lifespan=lifespan)

app.add_middleware(RequestIdMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception")
    return JSONResponse(
        status_code=500,
        content={
            "error": "internal_server_error",
            "request_id": get_request_id(),
        },
    )

app.include_router(entities.router,          prefix="/api/entities",     tags=["Entities"])
app.include_router(events.router,            prefix="/api/events",       tags=["Events"])
app.include_router(alerts.router,            prefix="/api/alerts",       tags=["Alerts"])
app.include_router(intelligence.router,      prefix="/api/intelligence", tags=["Intelligence"])
app.include_router(ai_config.router,          prefix="/api/ai",           tags=["AI Config"])
app.include_router(geoseer.router,            prefix="/api/geoseer",      tags=["GeoSeer"])
app.include_router(route_ops.router,          prefix="/api/routeops",     tags=["RouteOps"])
app.include_router(persons.router,            prefix="/api/persons",       tags=["Persons"])
app.include_router(playback_router.router,    prefix="/api/playback",      tags=["Playback"])
app.include_router(websocket_router.router,                               tags=["WebSocket"])

@app.get("/health")
async def health():
    return {
        "status": "online",
        "collectors": collector_manager.status(),
        "ai": ai_orchestrator.status(),
        "cache": await cache.ping(),
    }


@app.get("/ready")
async def ready():
    cache_state = await cache.ping()
    collectors = collector_manager.status()
    degraded_collectors = [
        name for name, meta in collectors.items()
        if meta.get("status") not in ("healthy", "running")
    ]
    return ok(
        data={
            "status": "ready",
            "cache": cache_state,
            "degraded_collectors": degraded_collectors,
            "collector_count": len(collectors),
        },
        message="service_ready",
    )
