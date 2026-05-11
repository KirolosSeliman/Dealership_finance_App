from scrapling_connector import ExtractionPolicy, extract_visible_vehicle_fields, fallback_strategies


def test_authorized_visible_extraction_uses_safe_fields():
    html = """
    <html><head><title>2021 Honda Civic EX</title></head>
    <body><h1>2021 Honda Civic EX</h1><p>$18,995</p><p>62,000 km</p></body></html>
    """
    result = extract_visible_vehicle_fields(
        html,
        ExtractionPolicy(
            access_strategy="scrapling_authorized_extraction",
            permission_basis="Dealer has permission to process this exported listing page.",
            source_name="Authorized Dealer Export",
            source_url="https://dealer.example/listing/1",
            robots_allowed=True,
        ),
    )

    assert result["ok"] is True
    assert result["year"] == 2021
    assert result["listed_price"] == 18995
    assert result["mileage_km"] == 62000


def test_forbidden_bypass_capabilities_degrade_to_other_sources():
    result = extract_visible_vehicle_fields(
        "<html><body><h1>2020 Toyota Corolla</h1></body></html>",
        ExtractionPolicy(
            access_strategy="scrapling_authorized_extraction",
            permission_basis="",
            source_name="Blocked Source",
            requested_capabilities=("captcha_bypass", "rate_limit_bypass"),
        ),
    )

    assert result["ok"] is False
    assert result["degraded"] is True
    assert any("Forbidden extraction capabilities" in error for error in result["errors"])
    assert "authorized_api" in result["fallback_strategies"]


def test_fallback_strategies_keep_market_snap_resilient():
    strategies = fallback_strategies("scrapling_authorized_extraction")

    assert "browser_extension_capture" in strategies
    assert "csv_import" in strategies
    assert "licensed_data_provider" in strategies
    assert "saved_historical_market_data" in strategies
