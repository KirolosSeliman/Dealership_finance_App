from __future__ import annotations

from datetime import datetime, timezone
from math import exp
from typing import Any

MARKET_TYPES = {
    "clean_retail_market",
    "clean_wholesale_market",
    "auction_market",
    "salvage_auction_market",
    "rebuilt_market",
    "parts_or_non_running_market",
}

NUMERIC_FEATURES = [
    "year",
    "mileage_km",
    "listed_price",
    "source_reliability_score",
    "data_quality_score",
    "visual_condition_score",
    "rust_visible_score",
    "damage_visible_score",
    "days_on_market",
    "price_drop_count",
    "time_decay_weight",
]

CATEGORICAL_FEATURES = [
    "make",
    "model",
    "trim",
    "body_type",
    "transmission",
    "drivetrain",
    "fuel_type",
    "province",
    "source_name",
    "source_type",
    "market_type",
    "title_status",
]


def normalize_training_row(row: dict[str, Any]) -> dict[str, Any]:
    market_type = str(row.get("market_type") or "clean_retail_market")
    if market_type not in MARKET_TYPES:
        raise ValueError(f"unsupported market_type: {market_type}")
    normalized = {key: row.get(key) for key in NUMERIC_FEATURES + CATEGORICAL_FEATURES}
    normalized["market_type"] = market_type
    normalized["target_price"] = float(row.get("target_price") or row.get("actual_sale_price") or row.get("listed_price") or 0)
    normalized["sample_weight"] = float(row.get("sample_weight") or sample_weight(row))
    return normalized


def sample_weight(row: dict[str, Any]) -> float:
    source_quality = float(row.get("source_reliability_score") or 65) / 100
    data_quality = float(row.get("data_quality_score") or 60) / 100
    time_weight = float(row.get("time_decay_weight") or time_decay_weight(row.get("captured_at")))
    market_weight = 0.86 if row.get("market_type") in {"salvage_auction_market", "parts_or_non_running_market"} else 1.0
    return round(max(0.02, source_quality * data_quality * time_weight * market_weight), 5)


def time_decay_weight(captured_at: Any, rare_vehicle: bool = False) -> float:
    if not captured_at:
        return 0.72
    try:
        captured = datetime.fromisoformat(str(captured_at).replace("Z", "+00:00"))
    except ValueError:
        return 0.72
    age_days = max(0, (datetime.now(timezone.utc) - captured).total_seconds() / 86400)
    half_life = 180 if rare_vehicle else 90
    return round(max(0.08, exp(-age_days / half_life)), 5)
