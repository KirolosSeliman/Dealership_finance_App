from __future__ import annotations

from statistics import median
from typing import Any

from feature_schema import normalize_training_row, validate_training_row


def build_candidate_report(rows: list[dict[str, Any]]) -> dict[str, Any]:
    normalized: list[dict[str, Any]] = []
    rejected_reasons: dict[str, int] = {}
    for row in rows:
        clean_row, reasons = validate_training_row(row)
        if clean_row is not None:
            normalized.append(clean_row)
            continue
        primary_reason = reasons[0] if reasons else "invalid_training_row"
        rejected_reasons[primary_reason] = rejected_reasons.get(primary_reason, 0) + 1

    by_market_type: dict[str, int] = {}
    by_target_source: dict[str, int] = {}
    by_carfax_status: dict[str, int] = {}
    for row in normalized:
        market_type = str(row["market_type"])
        by_market_type[market_type] = by_market_type.get(market_type, 0) + 1
        target_source = str(row["target_source"])
        by_target_source[target_source] = by_target_source.get(target_source, 0) + 1
        carfax_status = str(row.get("carfax_url_status") or row.get("carfaxUrlStatus") or "missing")
        by_carfax_status[carfax_status] = by_carfax_status.get(carfax_status, 0) + 1

    target_values = [row["target_price"] for row in normalized]
    vin_count = len([row for row in normalized if str(row.get("vin") or "").strip()])
    return {
        "row_count": len(normalized),
        "input_row_count": len(rows),
        "rejected_row_count": len(rows) - len(normalized),
        "rejection_reasons": rejected_reasons,
        "market_type_counts": by_market_type,
        "target_source_counts": by_target_source,
        "vin_coverage": round((vin_count / len(normalized)) * 100) if normalized else 0,
        "carfax_status_counts": by_carfax_status,
        "missing_mileage_count": len([row for row in normalized if row.get("mileage_km") in (None, "")]),
        "feature_schema": "market-snap-catboost-v1",
        "sample_weight_average": round(sum(row["sample_weight"] for row in normalized) / len(normalized), 5) if normalized else 0,
        "median_target": median(target_values) if normalized else None,
        "target_median": median(target_values) if normalized else None,
        "promotion": "manual_admin_promotion_required",
    }


def build_training_dataset(rows: list[dict[str, Any]]) -> dict[str, Any]:
    clean_rows = []
    for row in rows:
        try:
            clean_rows.append(normalize_training_row(row))
        except ValueError:
            continue
    return {
        "rows": clean_rows,
        "report": build_candidate_report(rows),
    }
