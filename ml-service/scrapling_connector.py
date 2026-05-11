from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


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
        if self.access_strategy == "scrapling_authorized_extraction" and not self.permission_basis.strip():
            errors.append("Scrapling extraction requires a permission basis or data agreement note.")
        blocked = sorted(set(self.requested_capabilities).intersection(FORBIDDEN_CAPABILITIES))
        if blocked:
            errors.append(f"Forbidden extraction capabilities requested: {', '.join(blocked)}.")
        if self.robots_allowed is False:
            errors.append("Robots or source policy disallows this extraction.")
        return errors


def extract_visible_vehicle_fields(html: str, policy: ExtractionPolicy) -> dict[str, Any]:
    """Extract visible vehicle fields without fetchers, stealth, CAPTCHA solving, or proxy behavior."""
    errors = policy.validate()
    if errors:
        return {
            "ok": False,
            "errors": errors,
            "degraded": True,
            "fallback_strategies": fallback_strategies(policy.access_strategy),
        }

    text_segments = visible_text_segments(html)
    text = clean(" ".join(text_segments))
    title = extract_title(html) or text[:120]
    result = {
        "ok": True,
        "extractor": "scrapling_optional" if scrapling_available() else "regex_visible_text_fallback",
        "source_name": policy.source_name,
        "source_url": policy.source_url,
        "access_strategy": policy.access_strategy,
        "permission_basis": policy.permission_basis,
        "title": clean(title),
        "year": extract_year(title) or extract_year(text),
        "mileage_km": extract_mileage_from_segments(text_segments),
        "listed_price": extract_price_from_segments(text_segments),
        "description": clean(text[:3000]),
        "warnings": [],
    }
    if not scrapling_available():
        result["warnings"].append("Scrapling is not installed; used visible-text fallback extraction.")
    return result


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


def visible_text(html: str) -> str:
    return clean(" ".join(visible_text_segments(html)))


def visible_text_segments(html: str) -> list[str]:
    try:
        from scrapling import Adaptor

        page = Adaptor(html)
        text = page.body.get_all_text(separator="\n") if page.body else page.get_all_text(separator="\n")
        return [clean(segment) for segment in text.splitlines() if clean(segment)]
    except Exception:
        without_scripts = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.IGNORECASE | re.DOTALL)
        separated = re.sub(r"<[^>]+>", "\n", without_scripts)
        return [clean(segment) for segment in separated.splitlines() if clean(segment)]


def extract_title(html: str) -> str | None:
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


def extract_price(text: str) -> float | None:
    match = re.search(r"\$\s?([\d\s,]+(?:\.\d{2})?)", text)
    if not match:
        return None
    return number(match.group(1))


def extract_price_from_segments(segments: list[str]) -> float | None:
    for segment in segments:
        price = extract_price(segment)
        if price is not None:
            return price
    return extract_price(" ".join(segments))


def extract_mileage(text: str) -> int | None:
    match = re.search(r"([\d\s,]+)\s?(?:km|kilometres|kilometers)\b", text, flags=re.IGNORECASE)
    if not match:
        return None
    value = number(match.group(1))
    return int(value) if value is not None else None


def extract_mileage_from_segments(segments: list[str]) -> int | None:
    for segment in segments:
        mileage = extract_mileage(segment)
        if mileage is not None:
            return mileage
    return extract_mileage(" ".join(segments))


def number(value: str) -> float | None:
    parsed = re.sub(r"[^\d.]", "", value)
    if not parsed:
        return None
    try:
        return float(parsed)
    except ValueError:
        return None


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()
