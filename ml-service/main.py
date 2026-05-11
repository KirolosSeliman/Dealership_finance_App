from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="Dealer Flow Market Snap ML Service", version="0.1.0")


class PredictionRequest(BaseModel):
    organization_id: str | None = None
    market_type: str
    features: dict[str, Any] = Field(default_factory=dict)


class TrainCandidateRequest(BaseModel):
    dataset_id: str | None = None
    market_type: str | None = None
    rows: list[dict[str, Any]] = Field(default_factory=list)


@app.post("/predict")
def predict(request: PredictionRequest):
    # Foundation fallback contract. Production CatBoost models are loaded only after promotion.
    listed_price = float(request.features.get("listed_price") or request.features.get("purchase_price") or 0)
    return {
        "estimator_type": "fallback_estimator",
        "model_version": "market-snap-ml-scaffold-v1",
        "market_type": request.market_type,
        "prediction": {
            "estimated_retail_market_value": listed_price,
            "confidence_score": 20,
        },
        "warnings": ["CatBoost production model is not promoted yet; comparable estimator should remain primary."],
    }


@app.post("/train-candidate")
def train_candidate(request: TrainCandidateRequest):
    return {
        "status": "queued",
        "model": "CatBoostRegressor",
        "market_type": request.market_type,
        "row_count": len(request.rows),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "promotion": "manual_admin_promotion_required",
    }


@app.get("/model-status")
def model_status():
    return {
        "production_model": None,
        "candidate_model": None,
        "fallback": "comparable_estimator",
        "catboost_enabled": False,
    }


@app.get("/metrics")
def metrics():
    return {
        "mae": None,
        "rmse": None,
        "mape": None,
        "median_absolute_error": None,
        "segments": {},
    }
