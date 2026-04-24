import os
import json
import logging
import base64
import aiohttp
from typing import Any, Optional

logger = logging.getLogger("sentinel.ai.providers")

class AIProvider:
    name: str
    async def complete(self, system: str, prompt: str) -> Optional[str]:
        raise NotImplementedError
    async def vision_complete(self, system: str, prompt: str, image_bytes: bytes, mime_type: str) -> Optional[str]:
        return None

# ── Anthropic Claude ──────────────────────────────────────────────
class AnthropicProvider(AIProvider):
    name = "claude"
    def __init__(self, api_key: str, model: str = "claude-sonnet-4-20250514"):
        self.api_key = api_key
        self.model = model

    async def complete(self, system: str, prompt: str) -> Optional[str]:
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        body = {
            "model": self.model,
            "max_tokens": 1024,
            "system": system,
            "messages": [{"role": "user", "content": prompt}],
        }
        try:
            async with aiohttp.ClientSession() as s:
                async with s.post("https://api.anthropic.com/v1/messages", headers=headers, json=body, timeout=aiohttp.ClientTimeout(total=30)) as r:
                    if r.status == 200:
                        d = await r.json()
                        return d["content"][0]["text"]
                    logger.error(f"Anthropic {r.status}: {await r.text()}")
        except Exception as e:
            logger.error(f"Anthropic error: {e}")
        return None

    async def vision_complete(self, system: str, prompt: str, image_bytes: bytes, mime_type: str) -> Optional[str]:
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        image_b64 = base64.b64encode(image_bytes).decode("ascii")
        body = {
            "model": self.model,
            "max_tokens": 1400,
            "system": system,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": mime_type,
                                "data": image_b64,
                            },
                        },
                    ],
                }
            ],
        }
        try:
            async with aiohttp.ClientSession() as s:
                async with s.post("https://api.anthropic.com/v1/messages", headers=headers, json=body, timeout=aiohttp.ClientTimeout(total=45)) as r:
                    if r.status == 200:
                        d = await r.json()
                        return d["content"][0]["text"]
                    logger.error(f"Anthropic vision {r.status}: {await r.text()}")
        except Exception as e:
            logger.error(f"Anthropic vision error: {e}")
        return None

# ── OpenAI / GPT ──────────────────────────────────────────────────
class OpenAIProvider(AIProvider):
    name = "openai"
    def __init__(self, api_key: str, model: str = "gpt-4o-mini"):
        self.api_key = api_key
        self.model = model

    async def complete(self, system: str, prompt: str) -> Optional[str]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "max_tokens": 1024,
        }
        try:
            async with aiohttp.ClientSession() as s:
                async with s.post("https://api.openai.com/v1/chat/completions", headers=headers, json=body, timeout=aiohttp.ClientTimeout(total=30)) as r:
                    if r.status == 200:
                        d = await r.json()
                        return d["choices"][0]["message"]["content"]
                    logger.error(f"OpenAI {r.status}: {await r.text()}")
        except Exception as e:
            logger.error(f"OpenAI error: {e}")
        return None

    async def vision_complete(self, system: str, prompt: str, image_bytes: bytes, mime_type: str) -> Optional[str]:
        image_b64 = base64.b64encode(image_bytes).decode("ascii")
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{image_b64}"}},
                    ],
                },
            ],
            "max_tokens": 1400,
        }
        try:
            async with aiohttp.ClientSession() as s:
                async with s.post("https://api.openai.com/v1/chat/completions", headers=headers, json=body, timeout=aiohttp.ClientTimeout(total=45)) as r:
                    if r.status == 200:
                        d = await r.json()
                        return d["choices"][0]["message"]["content"]
                    logger.error(f"OpenAI vision {r.status}: {await r.text()}")
        except Exception as e:
            logger.error(f"OpenAI vision error: {e}")
        return None

# ── Google Gemini ─────────────────────────────────────────────────
class GeminiProvider(AIProvider):
    name = "gemini"
    def __init__(self, api_key: str, model: str = "gemini-1.5-flash"):
        self.api_key = api_key
        self.model = model

    async def complete(self, system: str, prompt: str) -> Optional[str]:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={self.api_key}"
        body = {
            "system_instruction": {"parts": [{"text": system}]},
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"maxOutputTokens": 1024},
        }
        try:
            async with aiohttp.ClientSession() as s:
                async with s.post(url, json=body, timeout=aiohttp.ClientTimeout(total=30)) as r:
                    if r.status == 200:
                        d = await r.json()
                        return d["candidates"][0]["content"]["parts"][0]["text"]
                    logger.error(f"Gemini {r.status}: {await r.text()}")
        except Exception as e:
            logger.error(f"Gemini error: {e}")
        return None

    async def vision_complete(self, system: str, prompt: str, image_bytes: bytes, mime_type: str) -> Optional[str]:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={self.api_key}"
        image_b64 = base64.b64encode(image_bytes).decode("ascii")
        body = {
            "system_instruction": {"parts": [{"text": system}]},
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {"inline_data": {"mime_type": mime_type, "data": image_b64}},
                    ]
                }
            ],
            "generationConfig": {"maxOutputTokens": 1400},
        }
        try:
            async with aiohttp.ClientSession() as s:
                async with s.post(url, json=body, timeout=aiohttp.ClientTimeout(total=45)) as r:
                    if r.status == 200:
                        d = await r.json()
                        return d["candidates"][0]["content"]["parts"][0]["text"]
                    logger.error(f"Gemini vision {r.status}: {await r.text()}")
        except Exception as e:
            logger.error(f"Gemini vision error: {e}")
        return None

# ── Groq ──────────────────────────────────────────────────────────
class GroqProvider(AIProvider):
    name = "groq"
    def __init__(self, api_key: str, model: str = "llama-3.1-8b-instant"):
        self.api_key = api_key
        self.model = model

    async def complete(self, system: str, prompt: str) -> Optional[str]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "max_tokens": 1024,
        }
        try:
            async with aiohttp.ClientSession() as s:
                async with s.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=body, timeout=aiohttp.ClientTimeout(total=30)) as r:
                    if r.status == 200:
                        d = await r.json()
                        return d["choices"][0]["message"]["content"]
                    logger.error(f"Groq {r.status}: {await r.text()}")
        except Exception as e:
            logger.error(f"Groq error: {e}")
        return None

# ── Ollama (local) ────────────────────────────────────────────────
class OllamaProvider(AIProvider):
    name = "ollama"
    def __init__(self, base_url: str = "http://localhost:11434", model: str = "llama3.1:8b"):
        self.base_url = base_url.rstrip("/")
        self.model = model

    async def complete(self, system: str, prompt: str) -> Optional[str]:
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            "stream": False,
        }
        try:
            async with aiohttp.ClientSession() as s:
                async with s.post(f"{self.base_url}/api/chat", json=body, timeout=aiohttp.ClientTimeout(total=60)) as r:
                    if r.status == 200:
                        d = await r.json()
                        return d["message"]["content"]
                    logger.error(f"Ollama {r.status}: {await r.text()}")
        except Exception as e:
            logger.error(f"Ollama error: {e}")
        return None

# ── Provider Manager ──────────────────────────────────────────────
class ProviderManager:
    def __init__(self):
        self._providers: dict[str, AIProvider] = {}
        self._active: Optional[str] = None
        self._load_from_env()

    def _load_from_env(self):
        if k := os.getenv("ANTHROPIC_API_KEY"):
            self.register(AnthropicProvider(k))
        if k := os.getenv("OPENAI_API_KEY"):
            self.register(OpenAIProvider(k))
        if k := os.getenv("GEMINI_API_KEY"):
            self.register(GeminiProvider(k))
        if k := os.getenv("GROQ_API_KEY"):
            self.register(GroqProvider(k))
        # Ollama her zaman dene
        self.register(OllamaProvider(
            os.getenv("OLLAMA_URL", "http://localhost:11434"),
            os.getenv("OLLAMA_MODEL", "llama3.1:8b"),
        ))
        # İlk bulunanı aktif yap
        if self._providers and not self._active:
            self._active = next(iter(self._providers))

    def register(self, provider: AIProvider):
        self._providers[provider.name] = provider
        logger.info(f"✅ AI provider registered: {provider.name}")

    def set_active(self, name: str) -> bool:
        if name in self._providers:
            self._active = name
            logger.info(f"🔄 Active AI provider: {name}")
            return True
        return False

    def get_active(self) -> Optional[AIProvider]:
        return self._providers.get(self._active) if self._active else None

    def list_providers(self) -> list[dict]:
        return [
            {
                "name": p.name,
                "model": getattr(p, "model", ""),
                "active": p.name == self._active,
            }
            for p in self._providers.values()
        ]

    async def complete(self, system: str, prompt: str) -> Optional[str]:
        provider = self.get_active()
        if not provider:
            return None
        return await provider.complete(system, prompt)

    async def complete_vision(self, system: str, prompt: str, image_bytes: bytes, mime_type: str) -> Optional[str]:
        provider = self.get_active()
        if not provider:
            return None
        return await provider.vision_complete(system, prompt, image_bytes, mime_type)

    def supports_vision(self) -> bool:
        provider = self.get_active()
        if not provider:
            return False
        impl = getattr(provider, "vision_complete", None)
        return callable(impl) and provider.__class__.vision_complete is not AIProvider.vision_complete

    def status(self) -> dict:
        return {
            "active": self._active,
            "providers": self.list_providers(),
            "enabled": bool(self._active),
        }

provider_manager = ProviderManager()
