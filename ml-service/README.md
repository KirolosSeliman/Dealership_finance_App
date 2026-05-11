# Market Snap ML Service

FastAPI scaffold for the Market Snap CatBoostRegressor service.

The Dealer Flow app keeps the comparable estimator as the MVP production path. This service defines the CatBoost contract and candidate-training endpoints without automatically promoting a model.

Run locally:

```bash
python -m venv .venv
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```
