from __future__ import annotations

import time

from source_connectors.base import SourceConnector, SourceSyncMetrics, SourceSyncRequest, SourceSyncResult
from source_connectors.extraction import discover_listing_urls, extract_listing, fetch_visible_html, is_valid_listing


class OpenLaneConnector(SourceConnector):
    source_name = "OpenLane"
    source_type = "auction"
    market_type = "auction_market"

    def sync(self, request: SourceSyncRequest) -> SourceSyncResult:
        started = time.monotonic()
        metrics = SourceSyncMetrics()
        warnings: list[str] = []
        listings: list[dict] = []
        seen_urls: set[str] = set()

        if not request.baseSearchUrls:
            warnings.append("No OpenLane base search URLs are configured; sync completed without fetching listings.")

        for search_url in request.baseSearchUrls[: request.maxPages]:
            try:
                search_html = fetch_visible_html(search_url)
                metrics.pagesFetched += 1
                listing_urls = discover_listing_urls(search_html, search_url, request.maxListings - len(seen_urls))
                if not listing_urls:
                    listing_urls = [search_url]
                for listing_url in listing_urls:
                    if listing_url in seen_urls:
                        metrics.duplicatesDetected += 1
                        continue
                    seen_urls.add(listing_url)
                    metrics.listingUrlsDiscovered += 1
                    try:
                        html = search_html if listing_url == search_url else fetch_visible_html(listing_url)
                        listing = extract_listing(html, self.source_name, self.source_type, self.market_type, listing_url, request.province)
                        metrics.listingsExtracted += 1
                        if is_valid_listing(listing, self.source_name):
                            metrics.validListings += 1
                        else:
                            metrics.invalidListings += 1
                        listings.append(listing)
                    except Exception as exc:  # pragma: no cover - network/source dependent
                        metrics.invalidListings += 1
                        warnings.append(f"OpenLane listing fetch failed: {exc}")
                    if len(listings) >= request.maxListings:
                        break
            except Exception as exc:  # pragma: no cover - network/source dependent
                warnings.append(f"OpenLane search page fetch failed: {exc}")
            if len(listings) >= request.maxListings:
                break

        metrics.durationMs = int((time.monotonic() - started) * 1000)
        return SourceSyncResult(True, self.source_name, self.source_type, self.market_type, listings, metrics, warnings)
