from __future__ import annotations

import time

from source_connectors.base import SourceConnector, SourceSyncMetrics, SourceSyncRequest, SourceSyncResult
from source_connectors.extraction import discover_listing_urls, extract_listing, fetch_visible_html, is_valid_listing


class MarketplaceConnector(SourceConnector):
    source_name = "Facebook Marketplace"
    source_type = "retail"
    market_type = "clean_retail_market"

    def sync(self, request: SourceSyncRequest) -> SourceSyncResult:
        started = time.monotonic()
        metrics = SourceSyncMetrics()
        warnings: list[str] = []
        listings: list[dict] = []
        seen_fingerprints: set[str] = set()

        if not request.baseSearchUrls:
            warnings.append("No Facebook Marketplace base search URLs are configured; sync completed without fetching listings.")

        for search_url in request.baseSearchUrls[: request.maxPages]:
            try:
                search_html = fetch_visible_html(search_url)
                metrics.pagesFetched += 1
                listing_urls = discover_listing_urls(search_html, search_url, request.maxListings - len(listings))
                if not listing_urls:
                    listing_urls = [search_url]
                for listing_url in listing_urls:
                    try:
                        html = search_html if listing_url == search_url else fetch_visible_html(listing_url)
                        listing = extract_listing(html, self.source_name, self.source_type, self.market_type, listing_url, request.province)
                        fingerprint = marketplace_fingerprint(listing)
                        if fingerprint in seen_fingerprints:
                            metrics.duplicatesDetected += 1
                            continue
                        seen_fingerprints.add(fingerprint)
                        metrics.listingUrlsDiscovered += 1
                        metrics.listingsExtracted += 1
                        if is_valid_listing(listing, self.source_name):
                            metrics.validListings += 1
                            listings.append(listing)
                        else:
                            metrics.invalidListings += 1
                    except Exception as exc:  # pragma: no cover - network/source dependent
                        metrics.invalidListings += 1
                        warnings.append(f"Marketplace listing fetch failed: {exc}")
                    if len(listings) >= request.maxListings:
                        break
            except Exception as exc:  # pragma: no cover - network/source dependent
                warnings.append(f"Marketplace search page fetch failed: {exc}")
            if len(listings) >= request.maxListings:
                break

        metrics.durationMs = int((time.monotonic() - started) * 1000)
        return SourceSyncResult(True, self.source_name, self.source_type, self.market_type, listings, metrics, warnings)


def marketplace_fingerprint(listing: dict) -> str:
    return "|".join(
        str(listing.get(key, "")).strip().lower()
        for key in ["title", "year", "make", "model", "mileageKm", "listedPrice", "province"]
    )
