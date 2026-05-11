# Market Snap ML Service

FastAPI scaffold for the Market Snap CatBoostRegressor service.

The Dealer Flow app keeps the comparable estimator as the MVP production path. This service defines the CatBoost contract and candidate-training endpoints without automatically promoting a model.

## Optional Scrapling Extraction

Scrapling is included only as an optional extraction framework for authorized Market Snap connectors. Dealer Flow must use it only for visible-field parsing, adaptive extraction, user-assisted captures, internal/exported/imported pages, or sources where the dealership has permission, a contract, an API/data agreement, or another lawful basis.

Do not use Scrapling in this project for CAPTCHA bypass, login-wall bypass, anti-bot evasion, rate-limit bypass, proxy evasion, account restriction bypass, access-control bypass, or terms-of-service bypass.

Market Snap must continue to work through safer and more reliable data strategies if Scrapling is unavailable or a source becomes blocked, rate-limited, unavailable, or legally unusable:

- browser extension capture
- CSV/JSON imports
- authorized APIs
- licensed data providers
- dealership-owned data
- authorized source connectors
- saved historical/anonymized market data

Endpoint:

```text
POST /extract/authorized-listing
```

The request must include a `permission_basis`. If forbidden capabilities are requested, the service returns a degraded response with fallback strategies instead of extracting.

Run locally:

```bash
python -m venv .venv
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```
