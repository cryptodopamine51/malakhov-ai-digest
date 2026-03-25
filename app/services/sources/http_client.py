from __future__ import annotations

import httpx


class SourceHttpClient:
    def __init__(
        self,
        timeout_seconds: float = 10.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._client = httpx.AsyncClient(
            timeout=timeout_seconds,
            follow_redirects=True,
            transport=transport,
            headers={"User-Agent": "malakhov-ai-digest/0.1"},
        )

    async def fetch_text(self, url: str) -> str:
        response = await self._client.get(url)
        response.raise_for_status()
        return response.text

    async def aclose(self) -> None:
        await self._client.aclose()
