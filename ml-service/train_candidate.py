from __future__ import annotations

from statistics import median
from typing import Any

from feature_schema import normalize_training_row


def build_candidate_report(rows: list[dict[str, Any]]) -> dict[str, Any]:
    normalized = [normalize_training_row(row) for row in rows]
    by_market_type: dict[str, int] = {}
    for row in normalized:
      market_type = str(row["market_type"])
      by_market_type[market_type] = by_market_type.get(market_type, 0) + 1
    return {
        "row_count": len(normalized),
        "market_type_counts": by_market_type,
        "feature_schema": "market-snap-catboost-v1",
        "sample_weight_average": round(sum(row["sample_weight"] for row in normalized) / len(normalized), 5) if normalized else 0,
        "target_median": median([row["target_price"] for row in normalized]) if normalized else None,
        "promotion": "manual_admin_promotion_required",
    }
