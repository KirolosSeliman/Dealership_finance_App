from __future__ import annotations

from source_connectors.base import SourceConnector
from source_connectors.marketplace import MarketplaceConnector
from source_connectors.openlane import OpenLaneConnector


def connector_registry() -> dict[str, SourceConnector]:
    connectors: list[SourceConnector] = [OpenLaneConnector(), MarketplaceConnector()]
    return {connector.source_name.lower(): connector for connector in connectors}


def get_connector(source_name: str) -> SourceConnector:
    registry = connector_registry()
    connector = registry.get(source_name.lower())
    if not connector:
        supported = ", ".join(sorted(connector.source_name for connector in registry.values()))
        raise ValueError(f"Unsupported source '{source_name}'. Supported sources: {supported}.")
    return connector


def supported_sources() -> list[str]:
    return sorted(connector.source_name for connector in connector_registry().values())
