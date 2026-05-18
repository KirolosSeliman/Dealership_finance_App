import pytest
from fastapi.testclient import TestClient

from feature_schema import normalize_training_row
from main import app
from train_candidate import build_candidate_report, build_training_dataset


def base_row(**overrides):
    row = {
        "market_type": "auction_market",
        "year": 2021,
        "make": "Toyota",
        "model": "RAV4",
        "mileage_km": 52000,
        "listed_price": 22900,
        "source_reliability_score": 80,
        "data_quality_score": 90,
        "capture_kind": "verified_outcome",
        "is_training_eligible": True,
        "model_improvement_opted_in": True,
    }
    row.update(overrides)
    return row


def test_training_row_rejects_listed_price_as_target():
    with pytest.raises(ValueError, match="missing_verified_target"):
        normalize_training_row(base_row(capture_kind=None, is_training_eligible=None, model_improvement_opted_in=None))


def test_training_row_rejects_zero_target():
    with pytest.raises(ValueError, match="non_positive_target"):
        normalize_training_row(base_row(accepted_amount=0))


def test_training_row_rejects_observation_and_candidate_outcomes():
    for row, reason in [
        (base_row(capture_kind="observation", actual_sale_price=18000), "observation_only"),
        (base_row(capture_kind="candidate_outcome", accepted_amount=18000), "candidate_outcome"),
    ]:
        with pytest.raises(ValueError, match=reason):
            normalize_training_row(row)


def test_training_row_accepts_verified_openlane_accepted_amount():
    normalized = normalize_training_row(base_row(accepted_amount=17900, carfax_url_status="url_found", vin="2T3R1RFV5MW123456"))

    assert normalized["target_price"] == 17900
    assert normalized["target_source"] == "accepted_amount"
    assert normalized["target_confidence"] == "verified"
    assert normalized["is_training_eligible"] is True


def test_training_row_accepts_dealer_flow_actual_sale_price():
    normalized = normalize_training_row(base_row(
        source_name="Dealer Flow",
        source_type="dealer_flow_sale",
        capture_kind=None,
        is_training_eligible=None,
        model_improvement_opted_in=None,
        actual_sale_price=21250,
        market_type="clean_retail_market",
    ))

    assert normalized["target_price"] == 21250
    assert normalized["target_source"] == "actual_sale_price"
    assert normalized["target_confidence"] == "verified"


def test_candidate_training_report_includes_rejection_reasons_and_clean_dataset():
    rows = [
        base_row(accepted_amount=17900, vin="2T3R1RFV5MW123456", carfax_url_status="url_found"),
        base_row(capture_kind="candidate_outcome", sold_price_candidate=18250),
        base_row(market_type="unknown_market", accepted_amount=10000),
        base_row(capture_kind=None, is_training_eligible=None, model_improvement_opted_in=None),
    ]

    report = build_candidate_report(rows)
    dataset = build_training_dataset(rows)

    assert report["row_count"] == 1
    assert report["rejected_row_count"] == 3
    assert report["rejection_reasons"]["candidate_outcome"] == 1
    assert report["rejection_reasons"]["invalid_market_type"] == 1
    assert report["rejection_reasons"]["missing_verified_target"] == 1
    assert report["target_source_counts"]["accepted_amount"] == 1
    assert report["vin_coverage"] == 100
    assert report["carfax_status_counts"]["url_found"] == 1
    assert report["missing_mileage_count"] == 0
    assert report["median_target"] == 17900
    assert len(dataset["rows"]) == 1


def test_model_status_remains_candidate_only():
    response = TestClient(app).get("/model-status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["production_model"] is None
    assert payload["catboost_enabled"] is False
    assert payload["fallback"] == "comparable_estimator"


def test_candidate_dataset_export_returns_only_clean_rows():
    response = TestClient(app).post("/train-candidate/dataset", json={
        "market_type": "auction_market",
        "rows": [
            base_row(accepted_amount=17900, vin="2T3R1RFV5MW123456"),
            base_row(capture_kind="candidate_outcome", sold_price_candidate=18250),
            base_row(capture_kind=None, is_training_eligible=None, model_improvement_opted_in=None),
        ],
    })

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "candidate_only"
    assert payload["promotion"] == "manual_admin_promotion_required"
    assert len(payload["rows"]) == 1
    assert payload["rows"][0]["target_source"] == "accepted_amount"
    assert payload["report"]["rejected_row_count"] == 2
