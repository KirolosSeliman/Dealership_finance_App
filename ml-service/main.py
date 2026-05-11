from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, Field
from scrapling_connector import ExtractionPolicy, extract_visible_vehicle_fields, fallback_strategies

app = FastAPI(title="Dealer Flow Market Snap ML Service", version="0.1.0")


class PredictionRequest(BaseModel):
    organization_id: str | None = None
    market_type: str
    features: dict[str, Any] = Field(default_factory=dict)


class TrainCandidateRequest(BaseModel):
    dataset_id: str | None = None
    market_type: str | None = None
    rows: list[dict[str, Any]] = Field(default_factory=list)


class AuthorizedExtractionRequest(BaseModel):
    html: str
    source_name: str
    access_strategy: str = "scrapling_authorized_extraction"
    permission_basis: str
    source_url: str | None = None
    robots_allowed: bool | None = None
    requested_capabilities: list[str] = Field(default_factory=list)


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


@app.post("/extract/authorized-listing")
def extract_authorized_listing(request: AuthorizedExtractionRequest):
    policy = ExtractionPolicy(
        access_strategy=request.access_strategy,
        permission_basis=request.permission_basis,
        source_name=request.source_name,
        source_url=request.source_url,
        robots_allowed=request.robots_allowed,
        requested_capabilities=tuple(request.requested_capabilities),
    )
    return extract_visible_vehicle_fields(request.html, policy)


@app.get("/data-access-strategies")
def data_access_strategies():
    return {
        "primary": [
            "browser_extension_capture",
            "csv_import",
            "json_import",
            "authorized_api",
            "licensed_data_provider",
            "dealership_owned_data",
            "authorized_source_connector",
        ],
        "optional": ["scrapling_authorized_extraction"],
        "forbidden": [
            "captcha_bypass",
            "login_wall_bypass",
            "anti_bot_bypass",
            "rate_limit_bypass",
            "proxy_evasion",
            "account_restriction_bypass",
            "access_control_bypass",
            "terms_of_service_bypass",
        ],
        "degraded_fallbacks": fallback_strategies("scrapling_authorized_extraction"),
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
