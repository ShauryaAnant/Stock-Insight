"""
ML Service: loads the trained XGBoost model and provides
probability-based overall score predictions.
"""
import logging
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_MODEL_DIR = Path(__file__).resolve().parent.parent / "ml_artifacts"
_MODEL_PATH = _MODEL_DIR / "xgb_model.joblib"

# Fallback to old RF model if XGB not found yet
_MODEL_PATH_FALLBACK = _MODEL_DIR / "rf_model.joblib"

_model = None
_model_lock = threading.Lock()


def _load_model():
    """Lazily load the trained scikit-learn pipeline (thread-safe)."""
    global _model
    if _model is not None:
        return _model

    with _model_lock:
        if _model is not None:
            return _model

        model_path = _MODEL_PATH if _MODEL_PATH.exists() else _MODEL_PATH_FALLBACK

        if not model_path.exists():
            logger.warning(
                "ML model not found at %s — overall score will use weighted-average fallback.",
                _MODEL_PATH,
            )
            return None

        try:
            import joblib
            _model = joblib.load(model_path)
            logger.info("ML model loaded from %s", model_path)
        except Exception as e:
            logger.exception("Failed to load ML model: %s", e)

    return _model


def predict_overall_score(
    fundamental_score: float | None,
    technical_score: float | None,
    sentiment_score: float | None,
    sector: str | None,
    vix_level: float | None = None,
    stock_beta: float | None = None,
    peg_ratio: float | None = None,
    rsi_14: float | None = None,
) -> float | None:
    """
    Predict the probability that a stock goes UP in 30 days.

    Returns a 0-100 score (probability × 100), or None if the model
    is not available (caller should fall back to weighted average).

    Parameters
    ----------
    fundamental_score : 0-100 or None (imputed by pipeline)
    technical_score   : 0-100 or None (imputed by pipeline)
    sentiment_score   : 0-100 or None (imputed by pipeline)
    sector            : e.g. "Technology", "Banking" — or None/"Unknown"
    vix_level         : Current VIX index level, or None
    stock_beta        : Stock beta vs market, or None
    peg_ratio         : PEG ratio, or None
    rsi_14            : 14-day RSI, or None
    """
    model = _load_model()
    if model is None:
        return None

    try:
        import pandas as pd

        features = pd.DataFrame([{
            "fundamental_score": fundamental_score,
            "technical_score": technical_score,
            "sentiment_score": sentiment_score,
            "vix_level": vix_level,
            "stock_beta": stock_beta,
            "peg_ratio": peg_ratio,
            "rsi_14": rsi_14,
            "sector": sector or "Unknown",
        }])

        proba = model.predict_proba(features)[0]  # [prob_down, prob_up]
        prob_up = float(proba[1])  # probability of class 1 (UP)

        # Scale to 0-100, rounded to 1 decimal
        return round(prob_up * 100, 1)

    except Exception as e:
        logger.exception("ML prediction failed: %s", e)
        return None


def is_model_available() -> bool:
    """Check whether the ML model file exists and can be loaded."""
    return _load_model() is not None
