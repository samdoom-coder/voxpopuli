"""WebSocket live broadcasting for the simulation dashboard."""
import asyncio
import json
import logging

from fastapi import WebSocket, WebSocketDisconnect

log = logging.getLogger("voxpopuli.ws")

_clients: dict[str, set[WebSocket]] = {}


async def connect(simulation_id: str, ws: WebSocket):
    await ws.accept()
    _clients.setdefault(simulation_id, set()).add(ws)
    try:
        while True:
            # keepalive / client pings
            msg = await ws.receive_text()
            if msg == "ping":
                await ws.send_text("pong")
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        _clients.get(simulation_id, set()).discard(ws)
        if not _clients.get(simulation_id):
            _clients.pop(simulation_id, None)


async def broadcast(simulation_id: str, payload: dict):
    sockets = list(_clients.get(simulation_id, set()))
    if not sockets:
        return
    text = json.dumps(payload, ensure_ascii=False)
    dead = []
    for ws in sockets:
        try:
            await ws.send_text(text)
        except Exception:
            dead.append(ws)
    for ws in dead:
        _clients.get(simulation_id, set()).discard(ws)
