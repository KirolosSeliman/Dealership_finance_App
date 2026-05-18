from pathlib import Path

from source_connectors.base import SourceSyncRequest
from source_connectors.extraction import discover_listing_urls, extract_listing, is_valid_listing
from source_connectors.marketplace import MarketplaceConnector, marketplace_fingerprint
from source_connectors.openlane import OpenLaneConnector
from source_connectors.registry import get_connector, supported_sources


FIXTURES = Path(__file__).parent / "fixtures"


def read_fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_registry_supports_required_sources():
    assert supported_sources() == ["Facebook Marketplace", "OpenLane"]
    assert isinstance(get_connector("OpenLane"), OpenLaneConnector)
    assert isinstance(get_connector("Facebook Marketplace"), MarketplaceConnector)


def test_openlane_fixture_extracts_auction_listing():
    listing = extract_listing(read_fixture("openlane_listing.html"), "OpenLane", "auction", "auction_market", "https://openlane.test/vehicle/OL-12345", "QC")

    assert listing["sourceName"] == "OpenLane"
    assert listing["sourceType"] == "auction"
    assert listing["marketType"] == "auction_market"
    assert listing["sourceListingId"] == "OL-12345"
    assert listing["year"] == 2021
    assert listing["make"] == "Toyota"
    assert listing["model"] == "RAV4"
    assert listing["trim"] == "XLE"
    assert listing["listedPrice"] == 22900
    assert listing["mileageKm"] == 62000
    assert listing["province"] == "QC"
    assert is_valid_listing(listing, "OpenLane")


def test_marketplace_fixture_extracts_retail_listing():
    listing = extract_listing(read_fixture("marketplace_listing.html"), "Facebook Marketplace", "retail", "clean_retail_market", "https://facebook.test/marketplace/item/101", "QC")

    assert listing["sourceType"] == "retail"
    assert listing["marketType"] == "clean_retail_market"
    assert listing["make"] == "Honda"
    assert listing["model"] == "Civic"
    assert listing["listedPrice"] == 18995
    assert listing["mileageKm"] == 62000
    assert listing["sellerType"] == "private"
    assert is_valid_listing(listing, "Facebook Marketplace")


def test_search_page_discovers_listing_urls():
    urls = discover_listing_urls(read_fixture("marketplace_search_page.html"), "https://facebook.test/search", 5)

    assert "https://facebook.test/marketplace/item/101" in urls
    assert "https://facebook.test/marketplace/item/102" in urls


def test_invalid_listing_handling():
    listing = extract_listing(read_fixture("broken_listing.html"), "Facebook Marketplace", "retail", "clean_retail_market", None, "QC")

    assert is_valid_listing(listing, "Facebook Marketplace") is False
    assert "listedPrice" in listing["missingFields"]


def test_marketplace_fingerprint_is_stable_for_duplicates():
    listing = extract_listing(read_fixture("marketplace_listing.html"), "Facebook Marketplace", "retail", "clean_retail_market", "https://facebook.test/marketplace/item/101", "QC")
    duplicate = {**listing, "listingUrl": "https://facebook.test/marketplace/item/another"}

    assert marketplace_fingerprint(listing) == marketplace_fingerprint(duplicate)


def test_connectors_return_predictable_empty_sync_without_urls():
    request = SourceSyncRequest(
        sourceName="OpenLane",
        sourceType="auction",
        marketType="auction_market",
        maxPages=1,
        maxListings=5,
        baseSearchUrls=[],
        province="QC",
    )
    result = OpenLaneConnector().sync(request)

    assert result.ok is True
    assert result.listings == []
    assert result.metrics.pagesFetched == 0
    assert result.warnings
