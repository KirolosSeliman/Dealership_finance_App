from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class SourceSyncRequest:
    sourceName: str
    sourceType: str
    marketType: str
    maxPages: int = 10
    maxListings: int = 200
    baseSearchUrls: list[str] = field(default_factory=list)
    province: str = "QC"
    runReason: str = "cron"
    startedAt: str | None = None


@dataclass
class SourceSyncMetrics:
    pagesFetched: int = 0
    listingUrlsDiscovered: int = 0
    listingsExtracted: int = 0
    validListings: int = 0
    invalidListings: int = 0
    duplicatesDetected: int = 0
    durationMs: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "pagesFetched": self.pagesFetched,
            "listingUrlsDiscovered": self.listingUrlsDiscovered,
            "listingsExtracted": self.listingsExtracted,
            "validListings": self.validListings,
            "invalidListings": self.invalidListings,
            "duplicatesDetected": self.duplicatesDetected,
            "durationMs": self.durationMs,
        }


@dataclass
class SourceSyncResult:
    ok: bool
    sourceName: str
    sourceType: str
    marketType: str
    listings: list[dict[str, Any]]
    metrics: SourceSyncMetrics
    warnings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "sourceName": self.sourceName,
            "sourceType": self.sourceType,
            "marketType": self.marketType,
            "listings": self.listings,
            "metrics": self.metrics.as_dict(),
            "warnings": self.warnings,
        }


class SourceConnector:
    source_name: str
    source_type: str
    market_type: str

    def sync(self, request: SourceSyncRequest) -> SourceSyncResult:
        raise NotImplementedError


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
