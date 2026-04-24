from typing import List

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from core.ai.geoseer import analyze_images

router = APIRouter()

MAX_IMAGE_SIZE = 8 * 1024 * 1024  # 8MB
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}


@router.post("/analyze")
async def analyze_location_image(
    files: List[UploadFile] = File(...),
    mode: str = Form("fast"),
):
    if mode not in {"fast", "agent"}:
        raise HTTPException(status_code=400, detail="Invalid mode. Use fast or agent.")
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")
    if len(files) > 3:
        raise HTTPException(status_code=400, detail="Max 3 images allowed per analysis.")

    payloads = []
    for f in files:
        if f.content_type not in ALLOWED_TYPES:
            raise HTTPException(status_code=400, detail="Unsupported file type. Use JPG/PNG/WEBP.")
        blob = await f.read()
        if not blob:
            raise HTTPException(status_code=400, detail=f"Empty file: {f.filename or 'unknown'}")
        if len(blob) > MAX_IMAGE_SIZE:
            raise HTTPException(status_code=413, detail=f"Image too large ({f.filename}). Max 8MB.")
        payloads.append(
            {
                "bytes": blob,
                "mime_type": f.content_type or "image/jpeg",
                "filename": f.filename or "upload",
            }
        )

    result = await analyze_images(payloads, mode=mode)
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])

    return {"ok": True, "data": result}
