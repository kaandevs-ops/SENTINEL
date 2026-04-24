import json
import logging
import re
from typing import Any, Optional

from core.ai.providers import provider_manager

logger = logging.getLogger("sentinel.ai.geoseer")

GEOSEER_SYSTEM_PROMPT = """You are SENTINEL GeoSeer, an elite geolocation analyst.
Given a single image, infer what/where it is from visual evidence only.
Return strict JSON only, no markdown.
If uncertain, state uncertainty clearly and lower confidence."""


def _safe_json(text: str) -> Optional[Any]:
    if not text:
        return None
    match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
    if match:
        text = match.group(1)
    try:
        return json.loads(text)
    except Exception:
        return None


def _analysis_prompt(filename: str, mode: str) -> str:
    mode_hint = (
        "FAST MODE: concise, prioritize high-probability guesses."
        if mode == "fast"
        else "AGENT MODE: deeper analysis, include stronger visual reasoning and alternatives."
    )
    return (
        "Analyze this image for geolocation intelligence.\n"
        f"Filename: {filename}\n"
        f"{mode_hint}\n"
        "Return ONLY valid JSON with this exact schema:\n"
        '{'
        '"scene_type":"",'
        '"primary_location_guess":{"name":"","country":"","lat":null,"lon":null,"radius_km":null},'
        '"alternative_locations":[{"name":"","country":"","lat":null,"lon":null,"radius_km":null,"reason":""}],'
        '"confidence":0,'
        '"what_is_seen":[""],'
        '"geo_clues":[""],'
        '"risk_assessment":"",'
        '"recommended_next_steps":[""]'
        '}\n'
        "confidence must be 0-100 integer."
    )


async def analyze_image(image_bytes: bytes, mime_type: str, filename: str, *, mode: str = "fast") -> dict:
    if not provider_manager.get_active():
        return {"error": "No AI provider configured"}
    if not provider_manager.supports_vision():
        return {"error": "Active provider does not support image analysis"}

    prompt = _analysis_prompt(filename, mode)

    try:
        raw = await provider_manager.complete_vision(
            GEOSEER_SYSTEM_PROMPT,
            prompt,
            image_bytes=image_bytes,
            mime_type=mime_type,
        )
    except Exception as e:
        logger.error(f"GeoSeer provider error: {e}")
        return {"error": "GeoSeer analysis failed"}

    data = _safe_json(raw or "")
    if not isinstance(data, dict):
        return {"error": "Model did not return valid JSON"}

    confidence = data.get("confidence")
    if not isinstance(confidence, int):
        try:
            confidence = int(confidence)
        except Exception:
            confidence = 0
    data["confidence"] = max(0, min(100, confidence))

    primary = data.get("primary_location_guess")
    if not isinstance(primary, dict):
        primary = {}
    primary.setdefault("name", "")
    primary.setdefault("country", "")
    primary.setdefault("lat", None)
    primary.setdefault("lon", None)
    primary.setdefault("radius_km", None)
    data["primary_location_guess"] = primary

    alternatives = data.get("alternative_locations")
    if not isinstance(alternatives, list):
        alternatives = []
    cleaned_alts = []
    for item in alternatives[:10]:
        if not isinstance(item, dict):
            continue
        cleaned_alts.append(
            {
                "name": item.get("name", ""),
                "country": item.get("country", ""),
                "lat": item.get("lat"),
                "lon": item.get("lon"),
                "radius_km": item.get("radius_km"),
                "reason": item.get("reason", ""),
            }
        )
    data["alternative_locations"] = cleaned_alts

    return data


def _as_float(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(value)
    except Exception:
        return None


def _build_candidates(results: list[dict]) -> list[dict]:
    buckets: dict[str, dict] = {}

    for idx, res in enumerate(results):
        p = res.get("primary_location_guess") or {}
        confidence = int(res.get("confidence") or 0)
        items = [
            {
                "name": p.get("name", ""),
                "country": p.get("country", ""),
                "lat": p.get("lat"),
                "lon": p.get("lon"),
                "radius_km": p.get("radius_km"),
                "score": max(1, confidence),
                "source": f"image_{idx+1}:primary",
            }
        ]
        for alt in (res.get("alternative_locations") or [])[:5]:
            items.append(
                {
                    "name": alt.get("name", ""),
                    "country": alt.get("country", ""),
                    "lat": alt.get("lat"),
                    "lon": alt.get("lon"),
                    "radius_km": alt.get("radius_km"),
                    "score": max(1, int(confidence * 0.65)),
                    "source": f"image_{idx+1}:alt",
                }
            )

        for cand in items:
            name = (cand.get("name") or "").strip()
            country = (cand.get("country") or "").strip()
            if not name and not country:
                continue
            key = f"{name.lower()}::{country.lower()}"
            if key not in buckets:
                buckets[key] = {
                    "name": name,
                    "country": country,
                    "lat": _as_float(cand.get("lat")),
                    "lon": _as_float(cand.get("lon")),
                    "radius_km": _as_float(cand.get("radius_km")),
                    "score": 0.0,
                    "votes": 0,
                    "sources": [],
                }
            bucket = buckets[key]
            bucket["score"] += float(cand.get("score") or 0)
            bucket["votes"] += 1
            bucket["sources"].append(cand.get("source"))
            if bucket["lat"] is None:
                bucket["lat"] = _as_float(cand.get("lat"))
            if bucket["lon"] is None:
                bucket["lon"] = _as_float(cand.get("lon"))
            if bucket["radius_km"] is None:
                bucket["radius_km"] = _as_float(cand.get("radius_km"))

    ranked = sorted(buckets.values(), key=lambda x: (x["score"], x["votes"]), reverse=True)[:10]
    output = []
    for i, row in enumerate(ranked, start=1):
        output.append(
            {
                "rank": i,
                "name": row["name"],
                "country": row["country"],
                "lat": row["lat"],
                "lon": row["lon"],
                "radius_km": row["radius_km"],
                "score": round(row["score"], 1),
                "votes": row["votes"],
                "sources": row["sources"][:6],
            }
        )
    return output


async def analyze_images(inputs: list[dict], *, mode: str = "fast") -> dict:
    if not inputs:
        return {"error": "No images provided"}

    per_image = []
    merged_geo_clues: list[str] = []
    merged_seen: list[str] = []
    merged_steps: list[str] = []
    max_conf = 0
    scene_type = "unknown"

    for item in inputs[:3]:
        result = await analyze_image(
            image_bytes=item["bytes"],
            mime_type=item["mime_type"],
            filename=item["filename"],
            mode=mode,
        )
        if result.get("error"):
            return result
        per_image.append({"filename": item["filename"], "analysis": result})
        max_conf = max(max_conf, int(result.get("confidence") or 0))
        if scene_type == "unknown" and result.get("scene_type"):
            scene_type = result["scene_type"]
        merged_geo_clues.extend([x for x in (result.get("geo_clues") or []) if isinstance(x, str)])
        merged_seen.extend([x for x in (result.get("what_is_seen") or []) if isinstance(x, str)])
        merged_steps.extend([x for x in (result.get("recommended_next_steps") or []) if isinstance(x, str)])

    candidates = _build_candidates([x["analysis"] for x in per_image])
    primary = candidates[0] if candidates else None
    alternatives = candidates[1:6] if len(candidates) > 1 else []
    confidence = min(100, max_conf + (7 if len(inputs) > 1 else 0))

    return {
        "analysis_mode": mode,
        "image_count": len(per_image),
        "scene_type": scene_type,
        "confidence": confidence,
        "primary_location_guess": {
            "name": primary["name"] if primary else "",
            "country": primary["country"] if primary else "",
            "lat": primary["lat"] if primary else None,
            "lon": primary["lon"] if primary else None,
            "radius_km": primary["radius_km"] if primary else None,
        },
        "alternative_locations": [
            {
                "name": x["name"],
                "country": x["country"],
                "lat": x["lat"],
                "lon": x["lon"],
                "radius_km": x["radius_km"],
                "reason": f"Candidate rank #{x['rank']} with {x['votes']} vote(s)",
            }
            for x in alternatives
        ],
        "candidates": candidates,
        "what_is_seen": list(dict.fromkeys(merged_seen))[:12],
        "geo_clues": list(dict.fromkeys(merged_geo_clues))[:12],
        "risk_assessment": "Cross-image consistency improved confidence." if len(inputs) > 1 else "Single-image assessment.",
        "recommended_next_steps": list(dict.fromkeys(merged_steps))[:8],
        "per_image": per_image,
    }
