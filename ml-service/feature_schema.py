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

TARGET_FIELDS = [
    ("actual_sale_price", "verified"),
    ("accepted_amount", "verified"),
    ("negotiated_amount", "verified"),
    ("final_bid_amount", "verified"),
    ("buy_price_auction", "verified"),
    ("total_invoice_amount", "verified"),
    ("final_acquisition_cost", "verified"),
    ("manual_confirmed_price", "manual_verified"),
    ("user_confirmed_final_price", "manual_verified"),
]

OPENLANE_CAPTURE_KINDS = {"observation", "candidate_outcome", "verified_outcome", "manual_confirmation"}


def normalize_training_row(row: dict[str, Any]) -> dict[str, Any]:
    market_type = str(row.get("market_type") or "clean_retail_market")
    if market_type not in MARKET_TYPES:
        raise ValueError("invalid_market_type")
    target = verified_target(row)
    rejection_reasons = training_rejection_reasons(row, target)
    if rejection_reasons:
        raise ValueError(",".join(rejection_reasons))
    normalized = {key: row.get(key) for key in NUMERIC_FEATURES + CATEGORICAL_FEATURES}
    normalized["market_type"] = market_type
    normalized["target_price"] = target["value"]
    normalized["target_source"] = target["source"]
    normalized["target_confidence"] = target["confidence"]
    normalized["is_training_eligible"] = True
    normalized["vin"] = row.get("vin")
    normalized["carfax_url_status"] = row.get("carfax_url_status") or row.get("carfaxUrlStatus") or "missing"
    normalized["sample_weight"] = float(row.get("sample_weight") or sample_weight(row))
    return normalized


def validate_training_row(row: dict[str, Any]) -> tuple[dict[str, Any] | None, list[str]]:
    try:
        return normalize_training_row(row), []
    except ValueError as exc:
        reasons = [reason for reason in str(exc).split(",") if reason]
        return None, reasons or ["invalid_training_row"]


def training_rejection_reasons(row: dict[str, Any], target: dict[str, Any] | None = None) -> list[str]:
    reasons: list[str] = []
    market_type = str(row.get("market_type") or "clean_retail_market")
    if market_type not in MARKET_TYPES:
        reasons.append("invalid_market_type")

    capture_kind = str(row.get("capture_kind") or "").strip()
    if capture_kind == "observation" or str(row.get("page_type") or "") in {"active_listing", "watchlist"}:
        reasons.append("observation_only")
    if capture_kind == "candidate_outcome":
        reasons.append("candidate_outcome")
    if str(row.get("negotiation_status") or "").strip().lower() == "pending":
        reasons.append("pending_negotiation")

    if requires_openlane_training_gate(row):
        if row.get("model_improvement_opted_in") is not True:
            reasons.append("missing_model_improvement_opt_in")
        if row.get("is_training_eligible") is not True:
            reasons.append("not_training_eligible")

    resolved_target = target if target is not None else verified_target(row)
    if resolved_target is None:
        reasons.append("missing_verified_target")
    elif resolved_target["value"] <= 0:
        reasons.append("non_positive_target")

    return reasons


def verified_target(row: dict[str, Any]) -> dict[str, Any] | None:
    for source, confidence in TARGET_FIELDS:
        if source not in row:
            continue
        value = numeric_value(row.get(source))
        if value is None:
            continue
        return {
            "source": "manual_confirmed_price" if source == "user_confirmed_final_price" else source,
            "value": value,
            "confidence": confidence,
        }
    return None


def requires_openlane_training_gate(row: dict[str, Any]) -> bool:
    capture_kind = str(row.get("capture_kind") or "").strip()
    source_name = str(row.get("source_name") or "").lower()
    return capture_kind in OPENLANE_CAPTURE_KINDS or "openlane" in source_name


def numeric_value(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


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
