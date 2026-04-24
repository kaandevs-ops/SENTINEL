import json
import logging
import asyncio
from typing import Any, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()
logger = logging.getLogger("sentinel.websocket")
_connections: Set[WebSocket] = set()

def _get_app_state(websocket: WebSocket) -> Any:
    # Starlette/FastAPI stores the ASGI app in the connection scope.
    return websocket.scope.get("app").state

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    _connections.add(websocket)
    logger.info(f"WS connected ({len(_connections)} total)")
    state = _get_app_state(websocket)
    cache = state.cache
    ai_orchestrator = state.ai_orchestrator
    ops_service = state.ops_service

    async def relay(msg: dict):
        if websocket not in _connections:
            return
        try:
            await websocket.send_json(msg)
        except Exception:
            _connections.discard(websocket)

    channels = [
        "stream:aircraft", "stream:ships", "stream:satellites", "stream:gps_jamming",
        "stream:events", "stream:news", "stream:threats", "stream:wildfires", "stream:cameras", "stream:conflicts", "stream:cyber_iocs", "stream:alerts", "stream:ops", "stream:persons",
    ]
    for ch in channels:
        cache.subscribe(ch, relay)

    # Biraz bekle, sonra initial state gönder
    await asyncio.sleep(0.1)
    try:
        live = await cache.get_all_live()
        await websocket.send_json({"type": "initial_state", "data": live})
        await websocket.send_json({"type": "ops_snapshot", "events": ops_service.get_events(30)})
        logger.info(f"Initial state sent: aircraft={len(live.get('aircraft',[]))}")
    except Exception as e:
        logger.warning(f"Initial state warning (non-fatal): {e}")

    try:
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=30)
                msg = json.loads(raw)
                if msg.get("type") == "nl_query":
                    live = await cache.get_all_live()
                    answer = await ai_orchestrator.natural_language_query(
                        msg.get("query", ""),
                        live=live,
                    )
                    await websocket.send_json({"type": "nl_response", "answer": answer})
                elif msg.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception:
                    break
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WS error: {e}")
    finally:
        _connections.discard(websocket)
        for ch in channels:
            cache.unsubscribe(ch, relay)
        logger.info(f"WS disconnected ({len(_connections)} total)")
