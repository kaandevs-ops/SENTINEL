import math
from typing import Any, Iterable, List


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _route_points(start_lat: float, start_lon: float, end_lat: float, end_lon: float, steps: int = 32) -> List[dict]:
    out = []
    for i in range(steps + 1):
        t = i / steps
        out.append(
            {
                "lat": start_lat + (end_lat - start_lat) * t,
                "lon": start_lon + (end_lon - start_lon) * t,
                "index": i,
            }
        )
    return out


def _bearing_deg(start_lat: float, start_lon: float, end_lat: float, end_lon: float) -> float:
    y = math.sin(math.radians(end_lon - start_lon)) * math.cos(math.radians(end_lat))
    x = (
        math.cos(math.radians(start_lat)) * math.sin(math.radians(end_lat))
        - math.sin(math.radians(start_lat)) * math.cos(math.radians(end_lat)) * math.cos(math.radians(end_lon - start_lon))
    )
    brng = math.degrees(math.atan2(y, x))
    return (brng + 360) % 360


def _destination_point(lat: float, lon: float, bearing_deg: float, distance_km: float) -> tuple[float, float]:
    r = 6371.0
    d = distance_km / r
    b = math.radians(bearing_deg)
    lat1 = math.radians(lat)
    lon1 = math.radians(lon)
    lat2 = math.asin(math.sin(lat1) * math.cos(d) + math.cos(lat1) * math.sin(d) * math.cos(b))
    lon2 = lon1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(lat1), math.cos(d) - math.sin(lat1) * math.sin(lat2))
    return math.degrees(lat2), ((math.degrees(lon2) + 540) % 360) - 180


def _offset_midpoint(start_lat: float, start_lon: float, end_lat: float, end_lon: float, offset_km: float) -> tuple[float, float]:
    mid_lat = (start_lat + end_lat) / 2
    mid_lon = (start_lon + end_lon) / 2
    if abs(offset_km) < 0.001:
        return mid_lat, mid_lon
    bearing = _bearing_deg(start_lat, start_lon, end_lat, end_lon)
    side_bearing = (bearing + (90 if offset_km > 0 else -90)) % 360
    return _destination_point(mid_lat, mid_lon, side_bearing, abs(offset_km))


def _route_points_via(
    start_lat: float,
    start_lon: float,
    via_lat: float,
    via_lon: float,
    end_lat: float,
    end_lon: float,
    steps: int = 36,
) -> List[dict]:
    first_steps = max(8, int(steps * 0.5))
    second_steps = max(8, steps - first_steps)
    r1 = _route_points(start_lat, start_lon, via_lat, via_lon, first_steps)
    r2 = _route_points(via_lat, via_lon, end_lat, end_lon, second_steps)
    merged = r1 + r2[1:]
    for i, p in enumerate(merged):
        p["index"] = i
    return merged


def _min_distance_to_route_km(lat: float, lon: float, route: Iterable[dict]) -> tuple[float, int]:
    best = float("inf")
    best_idx = 0
    for p in route:
        d = _haversine_km(lat, lon, p["lat"], p["lon"])
        if d < best:
            best = d
            best_idx = p["index"]
    return best, best_idx


def _risk_level(score: float) -> str:
    if score >= 75:
        return "critical"
    if score >= 55:
        return "high"
    if score >= 30:
        return "medium"
    return "low"


async def analyze_route_ops(
    *,
    cache: Any,
    start_lat: float,
    start_lon: float,
    end_lat: float,
    end_lon: float,
    corridor_km: float = 180.0,
) -> dict:
    live = await cache.get_all_live()
    direct_distance_km = _haversine_km(start_lat, start_lon, end_lat, end_lon)
    offset_base = max(45.0, min(220.0, direct_distance_km * 0.17))
    mid_b = _offset_midpoint(start_lat, start_lon, end_lat, end_lon, offset_base)
    mid_c = _offset_midpoint(start_lat, start_lon, end_lat, end_lon, -offset_base)

    variants = [
        {"id": "A", "name": "Direct Corridor", "route": _route_points(start_lat, start_lon, end_lat, end_lon, steps=34)},
        {"id": "B", "name": "Northern/Side Bypass", "route": _route_points_via(start_lat, start_lon, mid_b[0], mid_b[1], end_lat, end_lon, steps=40)},
        {"id": "C", "name": "Southern/Side Bypass", "route": _route_points_via(start_lat, start_lon, mid_c[0], mid_c[1], end_lat, end_lon, steps=40)},
    ]

    route_outputs = []

    def evaluate_variant(route: List[dict], variant_id: str) -> dict:
        segments = [{"index": p["index"], "risk": 0.0} for p in route]
        incidents = []

        def push_incident(kind: str, src: dict, weight: float, title: str, severity: str) -> None:
            lat = src.get("latitude")
            lon = src.get("longitude")
            if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
                return
            distance_km, idx = _min_distance_to_route_km(float(lat), float(lon), route)
            if distance_km > corridor_km:
                return
            proximity = max(0.15, 1.0 - (distance_km / max(1.0, corridor_km)))
            impact = weight * proximity
            segments[idx]["risk"] += impact
            incidents.append(
                {
                    "kind": kind,
                    "title": title,
                    "severity": severity,
                    "lat": float(lat),
                    "lon": float(lon),
                    "distance_km": round(distance_km, 1),
                    "route_index": idx,
                    "impact": round(impact, 2),
                    "route_id": variant_id,
                }
            )

        for eq in (live.get("earthquakes") or [])[:250]:
            mag = float(eq.get("magnitude") or 0)
            weight = min(16.0, 3.0 + mag * 2.2)
            sev = "critical" if mag >= 6.2 else "high" if mag >= 5 else "medium"
            push_incident("earthquake", eq, weight, eq.get("title") or eq.get("place") or "Earthquake", sev)

        for th in (live.get("threats") or [])[:300]:
            push_incident("cyber_threat", th, 7.5, f"{th.get('malware') or 'Threat'} @ {th.get('ip') or '-'}", "medium")

        for wx in (live.get("weather_alerts") or [])[:300]:
            sev_raw = (wx.get("severity") or "").lower()
            weight = 14.0 if sev_raw == "extreme" else 11.0 if sev_raw == "severe" else 6.0
            sev = "critical" if sev_raw == "extreme" else "high" if sev_raw == "severe" else "medium"
            push_incident("weather", wx, weight, wx.get("event") or "Weather alert", sev)

        for jam in (live.get("gps_jamming") or [])[:200]:
            sev_raw = (jam.get("severity") or "").lower()
            weight = 15.0 if sev_raw == "critical" else 11.0 if sev_raw == "high" else 7.0
            push_incident("gps_jamming", jam, weight, f"GPS jamming: {jam.get('region') or 'unknown'}", sev_raw or "medium")

        for nw in (live.get("news") or [])[:200]:
            push_incident("news", nw, 3.5, nw.get("title") or "News", "low")

        incidents.sort(key=lambda x: x["impact"], reverse=True)
        top_incidents = incidents[:120]
        max_seg = max((s["risk"] for s in segments), default=0.0)
        total_risk = min(100.0, (sum(s["risk"] for s in segments) / max(1, len(segments))) * 2.4 + max_seg * 1.2)
        route_distance_km = 0.0
        for i in range(1, len(route)):
            route_distance_km += _haversine_km(route[i - 1]["lat"], route[i - 1]["lon"], route[i]["lat"], route[i]["lon"])

        base_speed_kmh = 760.0
        eta_h = route_distance_km / base_speed_kmh
        delay_min = min(220.0, sum(x["impact"] for x in top_incidents) * 1.6)
        eta_with_delay_h = eta_h + (delay_min / 60.0)

        return {
            "id": variant_id,
            "route": route,
            "segments": [{"index": s["index"], "risk": round(min(100.0, s["risk"] * 5), 2)} for s in segments],
            "incidents": top_incidents,
            "metrics": {
                "distance_km": round(route_distance_km, 1),
                "eta_min": round(eta_h * 60, 1),
                "delay_min": round(delay_min, 1),
                "eta_with_delay_min": round(eta_with_delay_h * 60, 1),
                "risk_score": round(total_risk, 2),
                "risk_level": _risk_level(total_risk),
            },
        }

    for v in variants:
        evaluated = evaluate_variant(v["route"], v["id"])
        evaluated["name"] = v["name"]
        route_outputs.append(evaluated)

    safest = min(route_outputs, key=lambda x: x["metrics"]["risk_score"])
    fastest = min(route_outputs, key=lambda x: x["metrics"]["eta_with_delay_min"])
    recommended = safest if (safest["metrics"]["risk_score"] + 7) < fastest["metrics"]["risk_score"] else fastest
    recommendation = (
        f"En guvenli rota: {safest['id']} ({safest['metrics']['risk_score']}). "
        f"En hizli rota: {fastest['id']} ({fastest['metrics']['eta_with_delay_min']} dk). "
        f"Onerilen: {recommended['id']}."
    )

    return {
        "routes": route_outputs,
        "recommended_route_id": recommended["id"],
        "safest_route_id": safest["id"],
        "fastest_route_id": fastest["id"],
        "summary": {
            "risk_score": recommended["metrics"]["risk_score"],
            "risk_level": recommended["metrics"]["risk_level"],
            "incident_count": len(recommended["incidents"]),
            "corridor_km": corridor_km,
            "recommendation": recommendation,
        },
    }
