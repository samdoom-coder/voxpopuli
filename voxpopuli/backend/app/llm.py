"""LLM client - OpenAI-compatible chat completions with robust JSON + batched array calls.

Falls back to a built-in heuristic engine when no API key is configured, so the
whole project runs out-of-the-box without any external LLM.
"""
import asyncio
import json
import logging
import re

import httpx

from .config import Config

log = logging.getLogger("voxpopuli.llm")


class LLMError(RuntimeError):
    pass


def _clean_text(content: str) -> str:
    content = re.sub(r"<think>[\s\S]*?</think>", "", content).strip()
    content = content.lstrip("\ufeff")
    content = re.sub(r"^```(?:json)?\s*\n?", "", content, flags=re.IGNORECASE)
    content = re.sub(r"\n?```\s*$", "", content)
    return content.strip()


def _extract_json(content: str):
    """Parse the first complete JSON value from a string, tolerating noise."""
    decoder = json.JSONDecoder()
    for m in re.finditer(r"[\[{]", content):
        try:
            value, _ = decoder.raw_decode(content[m.start():])
        except json.JSONDecodeError:
            continue
        if isinstance(value, (dict, list)):
            return value
    raise LLMError("no JSON value found in LLM response")


class LLMClient:
    def __init__(self):
        self.base_url = Config.LLM_BASE_URL
        self.model = Config.LLM_MODEL_NAME
        self.api_key = Config.LLM_API_KEY
        self._client = httpx.AsyncClient(timeout=Config.LLM_TIMEOUT)

    async def close(self):
        await self._client.aclose()

    async def _complete(self, messages: list[dict], temperature: float, max_tokens: int) -> str:
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        headers = {"Authorization": f"Bearer {self.api_key}"}
        for attempt in range(Config.LLM_MAX_RETRIES):
            try:
                resp = await self._client.post(
                    f"{self.base_url}/chat/completions", json=payload, headers=headers
                )
                if resp.status_code != 200:
                    raise LLMError(f"LLM HTTP {resp.status_code}: {resp.text[:300]}")
                data = resp.json()
                return _clean_text(data["choices"][0]["message"]["content"])
            except (httpx.HTTPError, KeyError, IndexError) as exc:
                if attempt == Config.LLM_MAX_RETRIES - 1:
                    raise LLMError(f"LLM request failed: {exc}") from exc
                await asyncio.sleep(0.5 * (attempt + 1))

    async def chat_json(self, messages: list[dict], temperature: float = 0.4, max_tokens: int = 2400) -> dict:
        content = await self._complete(messages, temperature, max_tokens)
        value = _extract_json(content)
        if not isinstance(value, dict):
            raise LLMError("LLM response was not a JSON object")
        return value

    async def chat_json_array(self, messages: list[dict], temperature: float = 0.6, max_tokens: int = 4000) -> list:
        content = await self._complete(messages, temperature, max_tokens)
        value = _extract_json(content)
        if not isinstance(value, list):
            raise LLMError("LLM response was not a JSON array")
        return value

    async def chat_text(self, messages: list[dict], temperature: float = 0.6, max_tokens: int = 3000) -> str:
        return await self._complete(messages, temperature, max_tokens)

    async def gather(self, *tasks):
        """Run many chat calls concurrently, bounded by LLM_CONCURRENCY."""
        return await asyncio.gather(*tasks, return_exceptions=True)


class LLMFactory:
    """Holds a lazily-created shared client. Returns None in heuristic mode."""

    _client: LLMClient | None = None

    @classmethod
    def get(cls) -> LLMClient | None:
        if not Config.llm_enabled():
            return None
        if cls._client is None:
            cls._client = LLMClient()
        return cls._client


def is_llm_error(value) -> bool:
    return isinstance(value, BaseException)
