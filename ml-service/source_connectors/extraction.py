from __future__ import annotations

import hashlib
import re
from typing import Any
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from scrapling_connector import (
    ExtractionPolicy,
    clean,
    extract_image_urls,
    extract_location,
    extract_make_model_trim,
    extract_mileage_from_segments,
    extract_price,
    extract_price_from_segments,
    extract_seller_type,
    extract_title,
    extract_title_status,
    extract_year,
    parse_visible_html,
)
from source_connectors.base import utc_now


SALVAGE_TERMS = [
    "rebuilt",
    "reconstruit",
    "salvage",
    "accidenté",
    "accidente",
    "parts",
    "pour pièces",
    "non-running",
    "non running",
    "ne roule pas",
    "flood",
    "fire",
]


def fetch_visible_html(url: str, timeout: int = 20) -> str:
    request = Request(url, headers={"user-agent": "DealerFlowMarketSnap/1.0"})
    with urlopen(request, timeout=timeout) as response:  # noqa: S310 - configured admin/source URLs only.
        content_type = response.headers.get("content-type", "")
        if "text/html" not in content_type and "application/xhtml" not in content_type:
            raise ValueError(f"Unsupported content type for source page: {content_type}")
        return response.read(2_000_000).decode("utf-8", errors="replace")


def discover_listing_urls(html: str, base_url: str | None, max_urls: int) -> list[str]:
    urls: list[str] = []
    for match in re.finditer(r"<a[^>]+href=['\"]([^'\"]+)['\"]", html, flags=re.IGNORECASE):
        href = match.group(1).strip()
        if not href or href.startswith("#") or href.startswith("javascript:"):
            continue
        absolute = urljoin(base_url or "", href)
        lower = absolute.lower()
        if any(token in lower for token in ["/listing", "/vehicle", "/item", "/marketplace/item", "vin="]):
            if absolute not in urls:
                urls.append(absolute)
        if len(urls) >= max_urls:
            break
    return urls


def extract_listing(html: str, source_name: str, source_type: str, market_type: str, listing_url: str | None, province: str) -> dict[str, Any]:
    parsed = parse_visible_html(html)
    segments = parsed["text_segments"]
    text = clean(" ".join(segments))
    title = extract_title(html, parsed.get("title")) or text[:140]
    year = extract_year(title) or extract_year(text)
    make, model, trim = extract_make_model_trim(title, year)
    mileage = extract_mileage_from_segments(segments)
    listed_price = best_price(segments, text)
    hammer_price = extract_hammer_price(text) if source_type == "auction" else None
    location, detected_province = extract_location(text)
    title_status = extract_title_status(text)
    image_urls = extract_image_urls(html, listing_url)
    warnings, missing = quality_notes(
        source_type=source_type,
        year=year,
        make=make,
        model=model,
        mileage=mileage,
        listed_price=listed_price,
        hammer_price=hammer_price,
    )
    resolved_market_type = market_type
    if source_name.lower().startswith("facebook") and any(term in text.lower() for term in SALVAGE_TERMS):
        resolved_market_type = "rebuilt_market" if "rebuilt" in text.lower() or "reconstruit" in text.lower() else "parts_or_non_running_market"
    quality = data_quality_score(missing, bool(image_urls), source_type)
    source_listing_id = extract_source_listing_id(text, listing_url)

    return prune_none(
        {
            "sourceName": source_name,
            "sourceType": source_type,
            "listingUrl": listing_url,
            "sourceListingId": source_listing_id,
            "title": clean(title),
            "description": text[:3000],
            "year": year,
            "make": make,
            "model": model,
            "trim": trim,
            "mileageKm": mileage,
            "listedPrice": listed_price,
            "auctionHammerPrice": hammer_price,
            "location": location,
            "province": detected_province or province,
            "sellerType": extract_seller_type(text),
            "titleStatus": title_status,
            "conditionReportText": condition_report(text),
            "imageCount": len(image_urls),
            "imageUrls": image_urls,
            "capturedAt": utc_now(),
            "marketType": resolved_market_type,
            "dataQualityScore": quality,
            "warnings": warnings,
            "missingFields": missing,
            "normalizedPayload": {
                "visibleTextPreview": text[:1000],
                "parser": parsed["extractor"],
                "rawPriceFields": extract_price_fields(text),
            },
        }
    )


def best_price(segments: list[str], text: str) -> float | None:
    for label in ["buy now", "buy-now", "current bid", "bid", "prix", "price"]:
        pattern = rf"{label}\s*:?\s*(\$?\s?[\d\s,.]+\s?\$?)"
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            parsed = extract_price(match.group(1))
            if parsed:
                return parsed
    return extract_price_from_segments(segments)


def extract_hammer_price(text: str) -> float | None:
    for label in ["hammer", "sold", "sale price"]:
        match = re.search(rf"{label}\s*:?\s*(\$?\s?[\d\s,.]+\s?\$?)", text, flags=re.IGNORECASE)
        if match:
            parsed = extract_price(match.group(1))
            if parsed:
                return parsed
    return None


def extract_price_fields(text: str) -> dict[str, float]:
    fields: dict[str, float] = {}
    for label in ["current bid", "buy now", "hammer", "sold", "price", "prix"]:
        match = re.search(rf"{label}\s*:?\s*(\$?\s?[\d\s,.]+\s?\$?)", text, flags=re.IGNORECASE)
        if match:
            parsed = extract_price(match.group(1))
            if parsed:
                fields[label] = parsed
    return fields


def extract_source_listing_id(text: str, listing_url: str | None) -> str:
    for pattern in [r"\b(?:lot|listing|stock|item|id)\s*#?:?\s*([A-Z0-9-]{5,})\b", r"/(?:item|listing|vehicle)/([A-Za-z0-9-]+)"]:
        haystack = listing_url or text
        match = re.search(pattern, haystack, flags=re.IGNORECASE)
        if match:
            return match.group(1)
    return hashlib.sha256(f"{listing_url or ''}|{text[:400]}".encode("utf-8")).hexdigest()[:24]


def quality_notes(source_type: str, year: int | None, make: str | None, model: str | None, mileage: int | None, listed_price: float | None, hammer_price: float | None) -> tuple[list[str], list[str]]:
    missing: list[str] = []
    warnings: list[str] = []
    for field, value in [("year", year), ("make", make), ("model", model)]:
        if not value:
            missing.append(field)
    if mileage is None:
        missing.append("mileageKm")
        warnings.append("Mileage was not visible; data quality reduced.")
    if listed_price is None and hammer_price is None:
        missing.append("listedPrice")
        warnings.append("Price was not visible; listing may be skipped by Dealer Flow.")
    if source_type == "retail" and listed_price is None:
        warnings.append("Marketplace retail listing without price is not a usable comparable.")
    return warnings, missing


def data_quality_score(missing: list[str], has_images: bool, source_type: str) -> int:
    score = 88 if source_type == "auction" else 76
    penalties = {"year": 20, "make": 20, "model": 20, "listedPrice": 28, "mileageKm": 10}
    for field in missing:
        score -= penalties.get(field, 8)
    if not has_images:
        score -= 4
    return max(10, min(95, score))


def condition_report(text: str) -> str | None:
    terms = ["condition", "report", "rust", "rouille", "damage", "accident", "clean title", "titre propre", "engine", "transmission"]
    snippets = [part for part in re.split(r"(?<=[.!?])\s+|\n", text) if any(term in part.lower() for term in terms)]
    return clean(" ".join(snippets))[:1500] if snippets else None


def is_valid_listing(listing: dict[str, Any], source_name: str) -> bool:
    if not listing.get("year") or not listing.get("make") or not listing.get("model"):
        return False
    if source_name.lower().startswith("facebook") and not listing.get("listedPrice"):
        return False
    return bool(listing.get("listedPrice") or listing.get("auctionHammerPrice"))


def prune_none(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item not in (None, "", [])}


def policy_for(source_name: str, source_url: str | None = None) -> ExtractionPolicy:
    return ExtractionPolicy(
        access_strategy="authorized_source_connector",
        permission_basis="Dealer Flow source sync uses configured source URLs and visible listing data only.",
        source_name=source_name,
        source_url=source_url,
        robots_allowed=True,
        requested_capabilities=(),
    )
