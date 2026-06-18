import aiohttp
import asyncio
import os
from typing import List, Optional
from pydantic import BaseModel, Field


class KagiSearchResult(BaseModel):
    title: str
    url: str
    snippet: str
    displayed_url: Optional[str] = None
    favicon: Optional[str] = None


class KagiSearchResponse(BaseModel):
    query: str
    results: List[KagiSearchResult] = Field(default_factory=list)
    total_results: Optional[int] = None
    search_time: Optional[float] = None


class AsyncKagiClient:
    def __init__(self, token: str):
        self.token = token
        self.base_url = "https://kagi.com"
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        }

    async def search(self, query: str, limit: int = 10) -> KagiSearchResponse:
        """Perform an async search using the Kagi API token"""
        params = {
            'q': query,
            'token': self.token,
            'limit': limit
        }
        
        async with aiohttp.ClientSession(headers=self.headers) as session:
            try:
                async with session.get(
                    f"{self.base_url}/search",
                    params=params,
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as response:
                    response.raise_for_status()
                    data = await response.json()
                    
                    # Parse response into Pydantic models
                    results = []
                    for item in data.get('data', []):
                        result = KagiSearchResult(
                            title=item.get('title', ''),
                            url=item.get('url', ''),
                            snippet=item.get('snippet', ''),
                            displayed_url=item.get('displayed_url'),
                            favicon=item.get('favicon')
                        )
                        results.append(result)
                    
                    return KagiSearchResponse(
                        query=query,
                        results=results,
                        total_results=data.get('total_results'),
                        search_time=data.get('search_time')
                    )
                    
            except Exception as e:
                print(f"Search failed: {e}")
                return KagiSearchResponse(query=query)

    async def search_raw(self, query: str) -> str:
        """Get raw response from Kagi search"""
        params = {
            'q': query,
            'token': self.token
        }
        
        async with aiohttp.ClientSession(headers=self.headers) as session:
            try:
                async with session.get(
                    f"{self.base_url}/search",
                    params=params,
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as response:
                    response.raise_for_status()
                    return await response.text()
                    
            except Exception as e:
                print(f"Search failed: {e}")
                return ""


def get_curl_command(query: str, token: str) -> str:
    """Generate curl command for testing"""
    return f'''curl -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
     "https://kagi.com/search?q={query.replace(" ", "%20")}&token={token}"'''


def get_xh_command(query: str, token: str) -> str:
    """Generate xh command for testing"""
    return f'''xh GET "https://kagi.com/search" \
     q=={query} \
     token=={token} \
     User-Agent:"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"'''


async def main():
    token = os.environ.get("KAGI_API_TOKEN")
    if not token:
        raise SystemExit("Set KAGI_API_TOKEN before running this probe.")
    # Test with curl/xh commands first
    print("=== CURL Command ===")
    print(get_curl_command("python async programming", token))
    print("\n=== XH Command ===")
    print(get_xh_command("python async programming", token))
    print()
    
    # Then use the async client
    client = AsyncKagiClient(token)
    results = await client.search("python async programming")
    print(f"Found {len(results.results)} results for '{results.query}'")
    
    for i, result in enumerate(results.results[:3], 1):
        print(f"{i}. {result.title}")
        print(f"   {result.url}")
        print(f"   {result.snippet[:100]}...")
        print()


if __name__ == "__main__":
    asyncio.run(main())