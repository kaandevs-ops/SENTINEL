from fastapi import APIRouter
from pydantic import BaseModel
from core.ai.providers import provider_manager

router = APIRouter()

class SetProviderRequest(BaseModel):
    provider: str
    model: str = ""
    api_key: str = ""
    base_url: str = ""

@router.get("/providers")
async def list_providers():
    return provider_manager.status()

@router.post("/providers/active")
async def set_active_provider(req: SetProviderRequest):
    from core.ai.providers import (
        AnthropicProvider, OpenAIProvider, GeminiProvider,
        GroqProvider, OllamaProvider
    )
    # Yeni key/model verilmişse provider'ı güncelle
    if req.api_key or req.model:
        mapping = {
            "claude":  lambda: AnthropicProvider(req.api_key or "", req.model or "claude-sonnet-4-20250514"),
            "openai":  lambda: OpenAIProvider(req.api_key or "", req.model or "gpt-4o-mini"),
            "gemini":  lambda: GeminiProvider(req.api_key or "", req.model or "gemini-1.5-flash"),
            "groq":    lambda: GroqProvider(req.api_key or "", req.model or "llama-3.1-8b-instant"),
            "ollama":  lambda: OllamaProvider(req.base_url or "http://localhost:11434", req.model or "llama3.2"),
        }
        if req.provider in mapping:
            provider_manager.register(mapping[req.provider]())

    ok = provider_manager.set_active(req.provider)
    return {"ok": ok, "status": provider_manager.status()}

@router.post("/providers/test")
async def test_provider():
    result = await provider_manager.complete(
        "You are a test assistant.",
        "Reply with exactly: SENTINEL AI ONLINE"
    )
    return {"ok": bool(result), "response": result}
