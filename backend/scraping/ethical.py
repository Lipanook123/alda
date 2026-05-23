"""Ethical web scraper with robots.txt compliance and rate limiting."""
from __future__ import annotations

import logging
import time
import urllib.parse
import urllib.robotparser

from backend.config import settings

log = logging.getLogger(__name__)

_domain_last_request: dict[str, float] = {}
_MIN_DELAY = 2.0  # seconds between requests to same domain


async def scrape_url(url: str) -> dict | None:
    """Scrape a URL respecting robots.txt and rate limits. Returns None if disabled or disallowed."""
    if not settings.scraping_enabled:
        return None

    parsed = urllib.parse.urlparse(url)
    domain = parsed.netloc

    # Check robots.txt
    if not _is_allowed(url, domain, parsed.scheme):
        log.info("robots.txt disallows %s", url)
        return None

    # Rate limiting per domain
    last = _domain_last_request.get(domain, 0.0)
    elapsed = time.time() - last
    if elapsed < _MIN_DELAY:
        time.sleep(_MIN_DELAY - elapsed)
    _domain_last_request[domain] = time.time()

    try:
        from playwright.async_api import async_playwright  # noqa: PLC0415

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page(user_agent="ALDA/0.1 (ethical scraper)")
            await page.goto(url, wait_until="networkidle", timeout=20000)

            title = await page.title()
            content = None
            for selector in ("article", "main", ".content", ".article-body", "body"):
                el = page.locator(selector).first
                try:
                    content = await el.inner_text(timeout=3000)
                    if content and len(content) > 100:
                        break
                except Exception:
                    continue

            await browser.close()

        return {
            "url": url,
            "title": title,
            "content": (content or "")[:5000],
        }
    except Exception as e:
        log.warning("Scraping failed for %s: %s", url, e)
        return None


def _is_allowed(url: str, domain: str, scheme: str) -> bool:
    robots_url = f"{scheme}://{domain}/robots.txt"
    rp = urllib.robotparser.RobotFileParser()
    rp.set_url(robots_url)
    try:
        rp.read()
        return rp.can_fetch("*", url)
    except Exception:
        # If robots.txt can't be fetched, allow by default
        return True
