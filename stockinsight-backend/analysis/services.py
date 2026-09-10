"""
Orchestration: run fundamental, technical, and sentiment analysis; compute overall score
and verdict; generate comprehensive report. Single entry point for "analyze ticker".
"""
import logging
import time
import concurrent.futures
from datetime import datetime, UTC
from typing import Any
import gc
from django.conf import settings

from fundamental.services import get_fundamental_analysis
from technical.services import get_technical_analysis
from sentiment.services import get_sentiment_analysis, preload_finbert_model
from reports.services import generate_report_bundle
from analysis.ml_service import predict_overall_score

logger = logging.getLogger(__name__)
timing_logger = logging.getLogger("analysis.timing")

# Weights for overall score (must sum to 1.0)
WEIGHT_FUNDAMENTAL = 0.35
WEIGHT_TECHNICAL = 0.35
WEIGHT_SENTIMENT = 0.30

# VIX cache (refreshed at most once per hour)
_vix_cache: dict[str, Any] = {"value": None, "fetched_at": 0.0}
_VIX_TTL_SECONDS = 3600


def _get_vix_level() -> float | None:
    """Fetch the latest VIX close, cached for 1 hour."""
    now = time.time()
    if _vix_cache["value"] is not None and (now - _vix_cache["fetched_at"]) < _VIX_TTL_SECONDS:
        return _vix_cache["value"]
    try:
        import yfinance as yf
        vix = yf.Ticker("^VIX")
        hist = vix.history(period="5d")
        if hist is not None and not hist.empty:
            val = round(float(hist["Close"].iloc[-1]), 2)
            _vix_cache["value"] = val
            _vix_cache["fetched_at"] = now
            return val
    except Exception as e:
        logger.warning("Failed to fetch VIX: %s", e)
    return _vix_cache["value"]  # return stale value if available


def _timing_log(enabled: bool, message: str, *args: Any) -> None:
    if enabled:
        timing_logger.info(message, *args)


def _compute_overall_score(
    fundamental_score: float | None,
    technical_score: float | None,
    sentiment_score: float | None,
) -> float:
    """Weighted average of available component scores. Missing components use 50 (neutral)."""
    total_weight = 0.0
    weighted_sum = 0.0
    if fundamental_score is not None:
        total_weight += WEIGHT_FUNDAMENTAL
        weighted_sum += WEIGHT_FUNDAMENTAL * fundamental_score
    else:
        total_weight += WEIGHT_FUNDAMENTAL
        weighted_sum += WEIGHT_FUNDAMENTAL * 50.0
    if technical_score is not None:
        total_weight += WEIGHT_TECHNICAL
        weighted_sum += WEIGHT_TECHNICAL * technical_score
    else:
        total_weight += WEIGHT_TECHNICAL
        weighted_sum += WEIGHT_TECHNICAL * 50.0
    if sentiment_score is not None:
        total_weight += WEIGHT_SENTIMENT
        weighted_sum += WEIGHT_SENTIMENT * sentiment_score
    else:
        total_weight += WEIGHT_SENTIMENT
        weighted_sum += WEIGHT_SENTIMENT * 50.0
    if total_weight <= 0:
        return 50.0
    return round(weighted_sum / total_weight, 1)


def _compute_verdict(overall_score: float) -> str:
    """Map overall score to Buy / Hold / Sell."""
    if overall_score >= 65:
        return "Buy"
    if overall_score >= 45:
        return "Hold"
    return "Sell"


def run_full_analysis(
    ticker: str,
    include_report: bool = True,
) -> dict[str, Any] | None:
    """
    Run fundamental, technical, and sentiment analysis; compute overall score and
    verdict; optionally generate LLM report.
    Returns one combined payload for the frontend, or None if ticker is invalid.
    """
    ticker = ticker.upper().strip()
    timing_logs_enabled = bool(getattr(settings, "ENABLE_TIMING_LOGS", True))

    analysis_started_at = datetime.now(UTC)
    analysis_started_perf = time.perf_counter()
    _timing_log(
        timing_logs_enabled,
        "PROCESS_START full_analysis ticker=%s started_at=%s",
        ticker,
        analysis_started_at.isoformat(),
    )

    # -----------------------------------------------------------------
    # Run fundamental, technical and sentiment concurrently
    # -----------------------------------------------------------------
    _timing_log(
        timing_logs_enabled,
        "PROCESS_START concurrent_analysis ticker=%s started_at=%s",
        ticker,
        datetime.now(UTC).isoformat(),
    )
    concurrent_started_perf = time.perf_counter()

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        future_fundamental = executor.submit(get_fundamental_analysis, ticker)
        future_technical = executor.submit(get_technical_analysis, ticker)
        # Sentiment runs in parallel; company_name defaults to None (handled internally)
        future_sentiment = executor.submit(get_sentiment_analysis, ticker, None)

        fundamental_result = future_fundamental.result()
        technical_result = future_technical.result()
        sentiment_result = future_sentiment.result()

    _timing_log(
        timing_logs_enabled,
        "PROCESS_END concurrent_analysis ticker=%s ended_at=%s duration_s=%.3f",
        ticker,
        datetime.now(UTC).isoformat(),
        time.perf_counter() - concurrent_started_perf,
    )

    # If we have no data at all, treat as invalid ticker
    if fundamental_result is None and technical_result is None:
        return None

    fundamental_score = fundamental_result.get("score") if fundamental_result else None
    technical_score = technical_result.get("score") if technical_result else None
    sentiment_score = sentiment_result.get("score") if sentiment_result else None

    # Overall Score: weighted average of pillar scores (deterministic)
    overall_score = _compute_overall_score(
        fundamental_score, technical_score, sentiment_score
    )

    # Extract additional features for ML model
    sector = None
    stock_beta = None
    peg_ratio = None
    if fundamental_result and fundamental_result.get("data"):
        fdata = fundamental_result["data"]
        sector = fdata.get("sector")
        stock_beta = fdata.get("beta")
        peg_ratio = fdata.get("pegRatio")

    rsi_14 = None
    if technical_result and technical_result.get("indicators"):
        rsi_14 = technical_result["indicators"].get("RSI")

    vix_level = _get_vix_level()

    # Predicted Score: ML model's 30-day upside probability (0-100)
    predicted_score = predict_overall_score(
        fundamental_score=fundamental_score,
        technical_score=technical_score,
        sentiment_score=sentiment_score,
        sector=sector,
        vix_level=vix_level,
        stock_beta=stock_beta,
        peg_ratio=peg_ratio,
        rsi_14=rsi_14,
    )
    if predicted_score is not None:
        logger.info("ML predicted score for %s: %.1f", ticker, predicted_score)
    else:
        logger.info("ML model unavailable for %s; using overall score for verdict", ticker)

    # Verdict: derived from ML predicted score (falls back to overall score)
    verdict_basis = predicted_score if predicted_score is not None else overall_score
    verdict = _compute_verdict(verdict_basis)

    report_bundle: dict[str, Any] = {
        "source": "disabled",
        "fullReport": "",
        "sections": {},
    }
    if include_report:
        report_started_at = datetime.now(UTC)
        report_started_perf = time.perf_counter()
        _timing_log(
            timing_logs_enabled,
            "PROCESS_START report_generation ticker=%s started_at=%s",
            ticker,
            report_started_at.isoformat(),
        )
        report_bundle = generate_report_bundle(
            ticker=ticker,
            fundamental_result=fundamental_result,
            technical_result=technical_result,
            sentiment_result=sentiment_result,
            overall_score=overall_score,
            verdict=verdict,
            predicted_score=predicted_score,
        )
        _timing_log(
            timing_logs_enabled,
            "PROCESS_END report_generation ticker=%s ended_at=%s duration_s=%.3f",
            ticker,
            datetime.now(UTC).isoformat(),
            time.perf_counter() - report_started_perf,
        )

    _timing_log(
        timing_logs_enabled,
        "PROCESS_END full_analysis ticker=%s ended_at=%s duration_s=%.3f",
        ticker,
        datetime.now(UTC).isoformat(),
        time.perf_counter() - analysis_started_perf,
    )

    if 'df' in locals(): del df 
    if 'news_data' in locals(): del news_data

    gc.collect()

    return {
        "ticker": ticker,
        "overview": {
            "fundamentalScore": fundamental_score,
            "technicalScore": technical_score,
            "sentimentScore": sentiment_score,
            "overallScore": overall_score,
            "predictedScore": predicted_score,
            "verdict": verdict,
        },
        "fundamental": fundamental_result,
        "technical": technical_result,
        "sentiment": sentiment_result,
        "report": report_bundle.get("fullReport", ""),
        "reportSections": report_bundle.get("sections", {}),
        "reportSource": report_bundle.get("source", "unknown"),
    }


def _run_single_for_comparison(ticker: str) -> dict[str, Any] | None:
    """
    Wrapper for comparison execution.
    """
    return run_full_analysis(ticker=ticker, include_report=False)


def run_parallel_comparison(tickers: list[str]) -> dict[str, Any]:
    """
    Run full analysis for multiple tickers concurrently in threads.
    Sentiment analysis uses the HF Inference API (no local model).

    Returns { "results": { ticker: analysis_result | { "error": str } } }
    """
    clean_tickers = list(dict.fromkeys(t.upper().strip() for t in tickers if t.strip()))

    if not clean_tickers:
        return {"results": {}}

    max_workers = min(len(clean_tickers), 6)
    results: dict[str, Any] = {}

    timing_logs_enabled = bool(getattr(settings, "ENABLE_TIMING_LOGS", True))
    comparison_started = time.perf_counter()
    _timing_log(
        timing_logs_enabled,
        "PROCESS_START parallel_comparison tickers=%s count=%d",
        ",".join(clean_tickers),
        len(clean_tickers),
    )

    # Validate HF API key is available before workers begin.
    prewarm_started = time.perf_counter()
    finbert_ready = preload_finbert_model()
    _timing_log(
        timing_logs_enabled,
        "PROCESS_STAGE hf_api_check ready=%s duration_s=%.3f",
        finbert_ready,
        time.perf_counter() - prewarm_started,
    )
    if not finbert_ready:
        logger.warning(
            "HF API key not configured; sentiment will use neutral fallback."
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_ticker = {
            executor.submit(_run_single_for_comparison, ticker): ticker
            for ticker in clean_tickers
        }

        for future in concurrent.futures.as_completed(future_to_ticker):
            ticker = future_to_ticker[future]
            try:
                result = future.result()
                if result is None:
                    results[ticker] = {"error": "Ticker not found or invalid"}
                else:
                    results[ticker] = result
            except Exception as exc:
                logger.exception("Comparison analysis failed for %s", ticker)
                results[ticker] = {"error": str(exc)}

    _timing_log(
        timing_logs_enabled,
        "PROCESS_END parallel_comparison tickers=%s duration_s=%.3f",
        ",".join(clean_tickers),
        time.perf_counter() - comparison_started,
    )

    return {"results": results}
