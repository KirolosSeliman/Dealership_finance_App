from pathlib import Path

from scrapling_connector import ExtractionPolicy, extract_visible_vehicle_fields


FIXTURES = Path(__file__).parent / "fixtures"


def read_fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def policy(**overrides):
    base = {
        "access_strategy": "scrapling_authorized_extraction",
        "permission_basis": "Dealer has permission to process this user-assisted visible listing capture.",
        "source_name": "Authorized Test Source",
        "source_url": "https://example.test/listing",
        "robots_allowed": True,
    }
    base.update(overrides)
    return ExtractionPolicy(**base)


def test_extracts_simple_english_listing():
    result = extract_visible_vehicle_fields(read_fixture("normal_listing.html"), policy(), source_type="retail")

    assert result["ok"] is True
    listing = result["listing"]
    assert listing["title"] == "2021 Honda Civic EX"
    assert listing["year"] == 2021
    assert listing["make"] == "Honda"
    assert listing["model"] == "Civic"
    assert listing["trim"] == "EX"
    assert listing["listedPrice"] == 18995
    assert listing["mileageKm"] == 62000
    assert listing["imageCount"] == 1


def test_extracts_french_price_mileage_and_location():
    result = extract_visible_vehicle_fields(read_fixture("french_listing.html"), policy(source_name="AutoHebdo"), source_type="retail")
    listing = result["listing"]

    assert listing["make"] == "Toyota"
    assert listing["model"] == "Corolla"
    assert listing["trim"] == "LE"
    assert listing["listedPrice"] == 18995
    assert listing["mileageKm"] == 62000
    assert listing["province"] == "QC"


def test_extracts_make_model_trim_from_title():
    result = extract_visible_vehicle_fields(read_fixture("rebuilt_listing.html"), policy(), source_type="retail")
    listing = result["listing"]

    assert listing["make"] == "Hyundai"
    assert listing["model"] == "Elantra"
    assert listing["trim"] == "Preferred"


def test_rebuilt_and_salvage_title_contexts_are_flagged():
    rebuilt = extract_visible_vehicle_fields(read_fixture("rebuilt_listing.html"), policy(), source_type="retail")
    salvage = extract_visible_vehicle_fields(read_fixture("salvage_listing.html"), policy(source_name="Copart"), source_type="salvage")

    assert rebuilt["listing"]["titleStatus"] == "rebuilt"
    assert salvage["listing"]["titleStatus"] == "salvage"
    assert any("rebuilt/salvage" in warning for warning in rebuilt["warnings"] + salvage["warnings"])


def test_missing_price_is_reported():
    html = "<h1>2021 Honda Civic EX</h1><p>62,000 km</p>"
    result = extract_visible_vehicle_fields(html, policy(), source_type="retail")

    assert result["ok"] is True
    assert "listedPrice" in result["missingFields"]


def test_missing_mileage_is_reported():
    html = "<h1>2021 Honda Civic EX</h1><p>$18,995</p>"
    result = extract_visible_vehicle_fields(html, policy(), source_type="retail")

    assert result["ok"] is True
    assert "mileageKm" in result["missingFields"]


def test_robots_disallowed_blocks_extraction_cleanly():
    result = extract_visible_vehicle_fields(read_fixture("normal_listing.html"), policy(robots_allowed=False), source_type="retail")

    assert result["ok"] is False
    assert result["policyDecision"] == "blocked"
    assert result["degraded"] is True


def test_invalid_extraction_capability_is_rejected():
    result = extract_visible_vehicle_fields(read_fixture("normal_listing.html"), policy(requested_capabilities=("captcha_bypass",)), source_type="retail")

    assert result["ok"] is False
    assert "Forbidden extraction capabilities" in result["warnings"][0]


def test_broken_html_uses_fallback_patterns_for_simple_fields():
    result = extract_visible_vehicle_fields(read_fixture("broken_html.html"), policy(), source_type="retail")
    listing = result["listing"]

    assert result["ok"] is True
    assert listing["year"] == 2022
    assert listing["make"] == "Hyundai"
    assert listing["model"] == "Elantra"
    assert listing["listedPrice"] == 18995
    assert listing["mileageKm"] == 62000
