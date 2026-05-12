from __future__ import annotations

import html as html_lib
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from typing import Any
from urllib.parse import urljoin


ALLOWED_ACCESS_STRATEGIES = {
    "browser_extension_capture",
    "csv_import",
    "json_import",
    "authorized_api",
    "licensed_data_provider",
    "dealership_owned_data",
    "authorized_source_connector",
    "scrapling_authorized_extraction",
}

FORBIDDEN_CAPABILITIES = {
    "captcha_bypass",
    "login_wall_bypass",
    "anti_bot_bypass",
    "rate_limit_bypass",
    "proxy_evasion",
    "account_restriction_bypass",
    "access_control_bypass",
    "terms_of_service_bypass",
}

COMMON_MAKES = [
    "Toyota",
    "Honda",
    "Hyundai",
    "Kia",
    "Nissan",
    "Ford",
    "Chevrolet",
    "Mazda",
    "Volkswagen",
    "BMW",
    "Mercedes",
    "Audi",
    "Lexus",
    "Acura",
    "Subaru",
    "Jeep",
    "Dodge",
    "Ram",
    "GMC",
    "Tesla",
    "Mitsubishi",
    "Volvo",
    "Infiniti",
    "Lincoln",
    "Buick",
    "Chrysler",
]

LOCATION_PROVINCES = {
    "qc": ["qc", "quebec", "québec", "montreal", "montréal", "laval", "longueuil", "terrebonne", "brossard", "gatineau", "sherbrooke", "trois-rivières", "trois-rivieres"],
    "on": ["on", "ontario", "ottawa", "toronto", "mississauga", "hamilton"],
}


@dataclass(frozen=True)
class ExtractionPolicy:
    access_strategy: str
    permission_basis: str
    source_name: str
    source_url: str | None = None
    robots_allowed: bool | None = None
    requested_capabilities: tuple[str, ...] = ()

    def validate(self) -> list[str]:
        errors: list[str] = []
        if self.access_strategy not in ALLOWED_ACCESS_STRATEGIES:
            errors.append("Unsupported data access strategy.")
        if len(self.permission_basis.strip()) < 3:
            errors.append("Authorized extraction requires a clear permission basis.")
        blocked = sorted(set(self.requested_capabilities).intersection(FORBIDDEN_CAPABILITIES))
        if blocked:
            errors.append(f"Forbidden extraction capabilities requested: {', '.join(blocked)}.")
        if self.robots_allowed is False:
            errors.append("Robots or source policy disallows this extraction.")
        return errors


def extract_visible_vehicle_fields(html: str, policy: ExtractionPolicy, source_type: str | None = None) -> dict[str, Any]:
    """Extract visible vehicle fields from supplied HTML only.

    This function never fetches pages, opens sessions, bypasses controls, rotates proxies,
    or reads private messages. It parses the already-captured HTML string.
    """
    policy_errors = policy.validate()
    fallback = fallback_strategies(policy.access_strategy)
    if policy_errors:
        return {
            "ok": False,
            "listing": None,
            "extractionQualityScore": 0,
            "warnings": policy_errors,
            "missingFields": [],
            "degraded": True,
            "policyDecision": "blocked",
            "policyReasons": policy_errors,
            "fallbackStrategies": fallback,
        }

    warnings: list[str] = []
    degraded = False
    parsed = parse_visible_html(html)
    if parsed["extractor"] == "regex_visible_text_fallback":
        degraded = True
        warnings.append("Scrapling parser was unavailable or failed; used conservative visible-text fallback.")

    text_segments = parsed["text_segments"]
    text = clean(" ".join(text_segments))
    title = extract_title(html, parsed.get("title")) or text[:140]
    year = extract_year(title) or extract_year(text)
    make, model, trim = extract_make_model_trim(title, year)
    listed_price = extract_price_from_segments(text_segments)
    mileage_km = extract_mileage_from_segments(text_segments)
    location, province = extract_location(text)
    title_status = extract_title_status(text)
    image_urls = extract_image_urls(html, policy.source_url)
    inferred_source_type = source_type or infer_source_type(policy.source_name, text)

    listing = {
        "sourceName": policy.source_name,
        "sourceType": inferred_source_type,
        "listingUrl": policy.source_url,
        "title": clean(title),
        "description": text[:3000],
        "year": year,
        "make": make,
        "model": model,
        "trim": trim,
        "mileageKm": mileage_km,
        "listedPrice": listed_price if inferred_source_type != "auction" else listed_price,
        "auctionHammerPrice": listed_price if inferred_source_type == "auction" else None,
        "location": location,
        "province": province,
        "sellerType": extract_seller_type(text),
        "titleStatus": title_status,
        "conditionReportText": extract_condition_report(text),
        "imageCount": len(image_urls),
        "imageUrls": image_urls,
        "capturedAt": datetime.now(timezone.utc).isoformat(),
    }

    missing = missing_fields(listing)
    if not make or not model:
        warnings.append("Make/model could not be confidently extracted from the visible title.")
    if title_status in {"rebuilt", "salvage"}:
        warnings.append("Title or listing text indicates rebuilt/salvage context; keep this separate from clean retail comparables.")
    if not image_urls:
        warnings.append("No visible listing images were found in the supplied HTML.")

    quality = extraction_quality_score(listing, missing, degraded)
    return {
        "ok": True,
        "listing": prune_none(listing),
        "extractionQualityScore": quality,
        "warnings": warnings,
        "missingFields": missing,
        "degraded": degraded,
        "policyDecision": "allowed",
        "policyReasons": [
            f"Access strategy '{policy.access_strategy}' is allowed.",
            "Extraction used supplied visible/captured HTML only.",
            "No bypass, crawler, proxy, or login-wall behavior was used.",
        ],
        "fallbackStrategies": fallback,
        "rawVisibleTextPreview": text[:1000],
        "extractor": parsed["extractor"],
    }


def fallback_strategies(current_strategy: str) -> list[str]:
    return [
        strategy
        for strategy in [
            "browser_extension_capture",
            "csv_import",
            "json_import",
            "authorized_api",
            "licensed_data_provider",
            "dealership_owned_data",
            "saved_historical_market_data",
        ]
        if strategy != current_strategy
    ]


def scrapling_available() -> bool:
    try:
        import scrapling  # noqa: F401
    except Exception:
        return False
    return True


def scrapling_version() -> str | None:
    try:
        return version("scrapling")
    except PackageNotFoundError:
        return None


def parse_visible_html(html: str) -> dict[str, Any]:
    sanitized = strip_sensitive_markup(html)
    try:
        from scrapling import Adaptor

        page = Adaptor(sanitized)
        text_source = page.body if page.body else page
        text = text_source.get_all_text(separator="\n")
        title = None
        title_node = page.css_first("title") or page.css_first("h1")
        if title_node:
            title = clean(title_node.get_all_text(separator=" "))
        return {
            "extractor": "scrapling_adaptor",
            "text_segments": [clean(segment) for segment in text.splitlines() if clean(segment)],
            "title": title,
        }
    except Exception:
        without_scripts = re.sub(r"<(script|style|noscript|svg|canvas|form)[^>]*>.*?</\1>", " ", sanitized, flags=re.IGNORECASE | re.DOTALL)
        separated = re.sub(r"<[^>]+>", "\n", without_scripts)
        return {
            "extractor": "regex_visible_text_fallback",
            "text_segments": [clean(html_lib.unescape(segment)) for segment in separated.splitlines() if clean(html_lib.unescape(segment))],
            "title": None,
        }


def strip_sensitive_markup(html: str) -> str:
    html = re.sub(r"<(script|style|noscript|svg|canvas|form)[^>]*>.*?</\1>", " ", html, flags=re.IGNORECASE | re.DOTALL)
    html = re.sub(r"<(input|textarea|select|button)[^>]*>.*?</\1>", " ", html, flags=re.IGNORECASE | re.DOTALL)
    html = re.sub(r"<(input|textarea|select|button)[^>]*?/?>", " ", html, flags=re.IGNORECASE)
    return html


def extract_title(html: str, scrapling_title: str | None = None) -> str | None:
    if scrapling_title:
        return scrapling_title
    heading = re.search(r"<h1[^>]*>(.*?)</h1>", html, flags=re.IGNORECASE | re.DOTALL)
    if heading:
        return clean(re.sub(r"<[^>]+>", " ", heading.group(1)))
    title = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.IGNORECASE | re.DOTALL)
    if title:
        return clean(title.group(1))
    return None


def extract_year(text: str) -> int | None:
    match = re.search(r"\b(19|20)\d{2}\b", text)
    return int(match.group(0)) if match else None


def extract_make_model_trim(title: str, year: int | None) -> tuple[str | None, str | None, str | None]:
    cleaned_title = clean(re.sub(r"[$€£][\d\s,.]+", " ", title))
    tokens = re.sub(r"[^\wÀ-ÿ\- ]", " ", cleaned_title).split()
    if year:
        tokens = [token for token in tokens if token != str(year)]
    lower_tokens = [token.lower() for token in tokens]
    for make in COMMON_MAKES:
        make_parts = make.lower().split()
        for index in range(0, len(lower_tokens)):
            if lower_tokens[index:index + len(make_parts)] == make_parts:
                model_index = index + len(make_parts)
                model = tokens[model_index] if model_index < len(tokens) else None
                trim_tokens = tokens[model_index + 1:model_index + 5]
                return make, model, " ".join(trim_tokens) or None
    return None, None, None


def extract_price(text: str) -> float | None:
    patterns = [
        r"\$\s?(\d{1,3}(?:[\s,]\d{3})+(?:\.\d{2})?|\d{4,8}(?:\.\d{2})?)",
        r"(\d{1,3}(?:[\s,]\d{3})+(?:\.\d{2})?|\d{4,8}(?:\.\d{2})?)\s?\$",
        r"(?:price|prix)\s*:?\s*\$?\s?(\d{1,3}(?:[\s,]\d{3})+|\d{4,8})",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            parsed = number(match.group(1))
            if parsed and 500 <= parsed <= 500_000:
                return parsed
    return None


def extract_price_from_segments(segments: list[str]) -> float | None:
    for segment in segments:
        price = extract_price(segment)
        if price is not None:
            return price
    return extract_price(" ".join(segments))


def extract_mileage(text: str) -> int | None:
    patterns = [
        r"(\d{1,3}(?:[\s,]\d{3})+|\d{4,7})\s?(?:km|kilometres|kilometers|kilomètres)\b",
        r"(?:mileage|odometer|kilom[eé]trage)\s*:?\s*(\d{1,3}(?:[\s,]\d{3})+|\d{4,7})",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            parsed = number(match.group(1))
            if parsed is not None and 0 <= parsed <= 2_000_000:
                return int(parsed)
    return None


def extract_mileage_from_segments(segments: list[str]) -> int | None:
    for segment in segments:
        mileage = extract_mileage(segment)
        if mileage is not None:
            return mileage
    return extract_mileage(" ".join(segments))


def extract_location(text: str) -> tuple[str | None, str | None]:
    lower = text.lower()
    for province, values in LOCATION_PROVINCES.items():
        for value in values:
            if re.search(rf"\b{re.escape(value)}\b", lower):
                location = extract_location_phrase(text, value)
                return location, province.upper()
    return None, None


def extract_location_phrase(text: str, matched_value: str) -> str | None:
    pattern = re.compile(r"([A-ZÀ-Ÿ][A-Za-zÀ-ÿ\-.']+(?:[\s-][A-ZÀ-Ÿ]?[A-Za-zÀ-ÿ\-.']+){0,2})\s*,?\s*(QC|ON|Québec|Quebec|Ontario)?", re.IGNORECASE)
    for match in pattern.finditer(text):
        if matched_value.lower() in match.group(0).lower():
            return clean(match.group(0))[:120]
    return matched_value.title()


def extract_title_status(text: str) -> str | None:
    lower = text.lower()
    if any(term in lower for term in ["salvage", "accidenté", "accidente", "parts only", "non-repairable", "non repairable"]):
        return "salvage"
    if any(term in lower for term in ["rebuilt", "reconstruit", "reconstructed"]):
        return "rebuilt"
    if any(term in lower for term in ["clean title", "titre propre", "clean carfax"]):
        return "clean"
    return None


def extract_seller_type(text: str) -> str | None:
    lower = text.lower()
    if any(term in lower for term in ["dealer", "dealership", "concessionnaire", "marchand"]):
        return "dealer"
    if any(term in lower for term in ["private seller", "particulier"]):
        return "private"
    return None


def extract_condition_report(text: str) -> str | None:
    lower = text.lower()
    keywords = ["rebuilt", "salvage", "accident", "rust", "rouille", "damage", "dommage", "transmission", "engine", "moteur", "clean title", "titre propre"]
    matches = [sentence for sentence in re.split(r"(?<=[.!?])\s+|\n", text) if any(keyword in sentence.lower() for keyword in keywords)]
    return clean(" ".join(matches))[:1500] if matches else None


def extract_image_urls(html: str, base_url: str | None = None) -> list[str]:
    urls: list[str] = []
    for match in re.finditer(r"<img[^>]+(?:src|currentSrc)=['\"]([^'\"]+)['\"]", html, flags=re.IGNORECASE):
        src = html_lib.unescape(match.group(1)).strip()
        if not src or src.startswith("data:image") or len(src) > 1000:
            continue
        if base_url:
            src = urljoin(base_url, src)
        if src not in urls:
            urls.append(src)
        if len(urls) >= 30:
            break
    return urls


def infer_source_type(source_name: str, text: str) -> str:
    combined = f"{source_name} {text}".lower()
    if any(term in combined for term in ["copart", "iaa", "salvage", "accidenté", "parts only"]):
        return "salvage"
    if any(term in combined for term in ["openlane", "auction", "enchère", "encan"]):
        return "auction"
    return "retail"


def missing_fields(listing: dict[str, Any]) -> list[str]:
    missing: list[str] = []
    for key in ["title", "year", "make", "model", "mileageKm"]:
        if not listing.get(key):
            missing.append(key)
    if not listing.get("listedPrice") and not listing.get("auctionHammerPrice"):
        missing.append("listedPrice")
    return missing


def extraction_quality_score(listing: dict[str, Any], missing: list[str], degraded: bool) -> int:
    score = 90 - len(missing) * 10
    if degraded:
        score -= 12
    if listing.get("imageCount", 0) == 0:
        score -= 5
    return max(15, min(95, score))


def prune_none(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None and item != ""}


def number(value: str) -> float | None:
    parsed = re.sub(r"[^\d.]", "", value)
    if not parsed:
        return None
    try:
        return float(parsed)
    except ValueError:
        return None


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", html_lib.unescape(value)).strip()
