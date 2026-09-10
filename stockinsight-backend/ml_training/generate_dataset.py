"""
generate_dataset.py
===================
Build a training dataset for the Random Forest overall-score predictor.

Data sources
------------
* Supabase PostgreSQL  → news_articles, daily_market_data, companies
* yfinance (local)     → fundamental info (batched with sleeps to avoid rate-limits)
* FinBERT (local)      → sentiment scores from historical news headlines

Output
------
  ml_training/training_data.csv

Usage
-----
  cd stockinsight-backend
  python -m ml_training.generate_dataset          # as a module (recommended)
  # or
  python ml_training/generate_dataset.py           # standalone
"""

import os
import sys
import time
import math
import logging
from datetime import datetime, timedelta, date
from pathlib import Path

import numpy as np
import pandas as pd
import psycopg2
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Make sure parent dir is on the path so we can import technical helpers
# ---------------------------------------------------------------------------
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from technical.services import (
    safe_rsi,
    safe_macd,
    safe_adx,
    safe_atr,
    safe_volume_spike,
    safe_breakout,
    score_engine,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
)
log = logging.getLogger("generate_dataset")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
load_dotenv(dotenv_path=_BACKEND_DIR.parent / ".env")

# ML training database (the Supabase instance with historical news + market data).
# Set ML_DATABASE_URL in .env to override.
DATABASE_URL = os.getenv("ML_DATABASE_URL")
if not DATABASE_URL:
    # Fallback: build from individual env vars (app DB)
    DATABASE_URL = (
        f"postgresql://{os.getenv('DB_USER')}:{os.getenv('DB_PASSWORD')}"
        f"@{os.getenv('DB_HOST')}:{os.getenv('DB_PORT')}/{os.getenv('DB_NAME')}"
    )

FORWARD_DAYS = 30          # target look-ahead window
NEWS_LOOKBACK_DAYS = 7     # how many days of news to consider for sentiment
MIN_PRICE_HISTORY = 50     # minimum trading days needed for technical indicators
YFINANCE_SLEEP_SEC = 1.5   # sleep between yfinance info calls
OUTPUT_CSV = Path(__file__).resolve().parent / "training_data.csv"

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def _get_connection():
    """Connect to the ML training database, handling Supabase-style usernames."""
    from urllib.parse import urlparse, unquote
    parsed = urlparse(DATABASE_URL)
    return psycopg2.connect(
        host=parsed.hostname,
        port=parsed.port or 5432,
        dbname=parsed.path.lstrip("/") or "postgres",
        user=unquote(parsed.username) if parsed.username else None,
        password=unquote(parsed.password) if parsed.password else None,
    )


def _fetch_companies(conn) -> pd.DataFrame:
    """Return all companies from the companies table."""
    with conn.cursor() as cur:
        cur.execute("SELECT id, ticker, name, sector, exchange FROM companies ORDER BY id")
        rows = cur.fetchall()
        cols = [desc[0] for desc in cur.description]
    return pd.DataFrame(rows, columns=cols)


def _fetch_market_data(conn, company_id: int) -> pd.DataFrame:
    """Return daily OHLCV for a company, sorted by date."""
    sql = """
        SELECT date, open, high, low, close, volume
        FROM daily_market_data
        WHERE company_id = %s
        ORDER BY date
    """
    with conn.cursor() as cur:
        cur.execute(sql, (company_id,))
        rows = cur.fetchall()
        cols = [desc[0] for desc in cur.description]
    df = pd.DataFrame(rows, columns=cols)
    if not df.empty:
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date").sort_index()
        # Rename to match yfinance conventions used by indicator helpers
        df.columns = [c.capitalize() for c in df.columns]
    return df


def _fetch_news_headlines(conn, company_id: int, start_date: date, end_date: date) -> list[str]:
    """Return news headlines for a company in a date range."""
    sql = """
        SELECT na.headline
        FROM news_articles na
        JOIN news_company_map ncm ON ncm.news_id = na.id
        WHERE ncm.company_id = %s
          AND na.published_at >= %s
          AND na.published_at < %s
          AND na.headline IS NOT NULL
          AND na.headline != ''
        ORDER BY na.published_at DESC
    """
    with conn.cursor() as cur:
        cur.execute(sql, (company_id, start_date, end_date))
        return [row[0] for row in cur.fetchall()]


def _get_unique_news_dates(conn, company_id: int) -> list[date]:
    """Return the distinct dates on which this company had news coverage."""
    sql = """
        SELECT DISTINCT DATE(na.published_at) AS d
        FROM news_articles na
        JOIN news_company_map ncm ON ncm.news_id = na.id
        WHERE ncm.company_id = %s
          AND na.published_at IS NOT NULL
        ORDER BY d
    """
    with conn.cursor() as cur:
        cur.execute(sql, (company_id,))
        return [row[0] for row in cur.fetchall()]


# ---------------------------------------------------------------------------
# Sentiment scoring  (reuses FinBERT logic from sentiment/services.py)
# ---------------------------------------------------------------------------

_finbert_pipeline = None


def _load_finbert():
    global _finbert_pipeline
    if _finbert_pipeline is not None:
        return _finbert_pipeline
    try:
        from transformers import pipeline as hf_pipeline
        _finbert_pipeline = hf_pipeline(
            "sentiment-analysis",
            model="ProsusAI/finbert",
            truncation=True,
            max_length=512,
        )
        log.info("FinBERT loaded successfully.")
    except Exception as e:
        log.warning("FinBERT not available: %s — sentiment will fallback to 50.", e)
    return _finbert_pipeline


def _sentiment_score(headlines: list[str]) -> float:
    """Run FinBERT over headlines and return 0-100 score (same logic as sentiment/services.py)."""
    if not headlines:
        return 50.0
    pipe = _load_finbert()
    if pipe is None:
        return 50.0
    try:
        results = pipe(headlines)
    except Exception as e:
        log.warning("FinBERT failed: %s", e)
        return 50.0

    score_map = {"positive": 1, "negative": -1, "neutral": 0}
    total, count = 0.0, 0
    for res in results:
        label = (res.get("label") or "").lower()
        if label == "neutral":
            continue
        conf = float(res.get("score", 0.0))
        total += score_map.get(label, 0) * conf
        count += 1
    if count == 0:
        return 50.0
    avg = total / count
    return round(50 + 50 * max(-1.0, min(1.0, avg)), 1)


# ---------------------------------------------------------------------------
# Technical score from raw OHLCV  (reuses technical/services.py helpers)
# ---------------------------------------------------------------------------

def _technical_score_from_df(df: pd.DataFrame) -> float | None:
    """
    Compute the 0-100 technical score given a DataFrame with
    columns: Open, High, Low, Close, Volume (sorted by date).
    Returns None if not enough data.
    """
    if df is None or len(df) < MIN_PRICE_HISTORY:
        return None

    close = df["Close"]
    rsi_s = safe_rsi(close)
    macd_s, macd_sig, _ = safe_macd(close)
    adx_s = safe_adx(df)
    atr_s = safe_atr(df)

    sma20 = close.rolling(20, min_periods=1).mean()
    sma50 = close.rolling(50, min_periods=1).mean()
    sma200 = close.rolling(200, min_periods=1).mean()

    vol_spike = bool(safe_volume_spike(df))
    breakout = safe_breakout(df)
    breakout = str(breakout) if breakout else None

    result = score_engine(
        close=float(close.iloc[-1]),
        sma20=float(sma20.iloc[-1]),
        sma50=float(sma50.iloc[-1]),
        sma200=float(sma200.iloc[-1]),
        rsi=float(rsi_s.iloc[-1]),
        macd=float(macd_s.iloc[-1]),
        macd_signal=float(macd_sig.iloc[-1]),
        adx=float(adx_s.iloc[-1]),
        atr=float(atr_s.iloc[-1]),
        volume_spike=vol_spike,
        breakout_signal=breakout,
    )
    return result["score"]


# ---------------------------------------------------------------------------
# Fundamental score (simplified — avoids per-day API calls)
# ---------------------------------------------------------------------------
# Because fundamental data doesn't change daily, we fetch each company's info
# once via yfinance and reuse across all dates for that company.

def _safe_get(info: dict, *keys, default=None):
    for k in keys:
        if k in info and info[k] is not None:
            return info[k]
    return default


def _normalize_percentage(val, is_yield=False):
    if val is None:
        return None
    try:
        f_val = float(val)
        threshold = 0.05 if is_yield else 0.8
        if abs(f_val) > threshold:
            return f_val / 100.0
        return f_val
    except (ValueError, TypeError):
        return None


def _compute_fundamental_score(info: dict) -> float | None:
    """
    Simplified version of fundamental/services.py _compute_fundamental_score.
    No sector-PE normalisation (that requires additional API calls per peer).
    Returns 0-100 or None if info is empty.
    """
    if not info or "symbol" not in info:
        return None

    score = 0.0
    sector = _safe_get(info, "sector", default="")
    is_financial = sector == "Financial Services"

    current_price = _safe_get(info, "currentPrice", "regularMarketPrice")
    eps = _safe_get(info, "trailingEps")
    pb_ratio = _safe_get(info, "priceToBook")
    eps_growth = _safe_get(info, "earningsGrowth")
    rev_growth = _safe_get(info, "revenueGrowth")
    op_margin = _safe_get(info, "operatingMargins")
    net_margin = _safe_get(info, "profitMargins")
    de = _safe_get(info, "debtToEquity")
    div_yield = _normalize_percentage(_safe_get(info, "dividendYield"), is_yield=True)
    payout = _safe_get(info, "payoutRatio")

    pe = _safe_get(info, "trailingPE")
    if pe is None:
        pe = _safe_get(info, "forwardPE")
    if pe is None and current_price and eps and eps > 0:
        pe = current_price / eps

    peg = _safe_get(info, "pegRatio")
    if peg is None and pe is not None and eps_growth is not None and eps_growth > 0:
        peg = pe / (eps_growth * 100)

    roe = _safe_get(info, "returnOnEquity")
    if roe is None and eps and current_price and pb_ratio and current_price > 0:
        bvps = current_price / pb_ratio
        if bvps > 0:
            roe = eps / bvps

    total_cash = _safe_get(info, "totalCash")
    total_debt = _safe_get(info, "totalDebt")

    cr = _safe_get(info, "currentRatio")
    if cr is None and total_cash is not None and total_debt is not None:
        if total_debt == 0 or (total_cash / total_debt) > 1.5:
            cr = 2.0
        elif (total_cash / total_debt) > 1.0:
            cr = 1.2

    fcf = _safe_get(info, "freeCashflow")
    if fcf is None and total_cash is not None and total_debt is not None:
        if total_cash > total_debt:
            fcf = 1

    # Scoring (same pillars as fundamental/services.py)
    if peg is not None and peg > 0:
        score += 5 * (1 - math.tanh((peg - 1.25) / 0.25))
    if pe is not None and pe > 0:
        score += 5 * (1 - math.tanh((pe - 20) / 5))
    if pb_ratio is not None and pb_ratio > 0:
        score += 5 * (1 - math.tanh((pb_ratio - 2.25) / 0.75))

    if roe is not None:
        score += 5 * (1 + math.tanh((roe - 0.115) / 0.035))
    if op_margin is not None:
        score += 5 * (1 + math.tanh((op_margin - 0.10) / 0.05))
    if net_margin is not None:
        score += 5 * (1 + math.tanh((net_margin - 0.075) / 0.025))

    if is_financial:
        roa = _safe_get(info, "returnOnAssets")
        if roa is not None:
            score += 7.5 * (1 + math.tanh((roa - 0.0125) / 0.0025))
        if net_margin is not None:
            score += 5 * (1 + math.tanh((net_margin - 0.15) / 0.05))
    else:
        if de is not None:
            score += 5 * (1 - math.tanh((de - 100) / 50))
        elif total_debt == 0:
            score += 10
        if cr is not None and cr > 0:
            score += 5 * (1 + math.tanh((cr - 1.25) / 0.25))
        if fcf is not None and fcf > 0:
            score += 5

    if rev_growth is not None:
        score += 2.5 * (1 + math.tanh((rev_growth - 0.05) / 0.05))
    if eps_growth is not None:
        score += 2.5 * (1 + math.tanh((eps_growth - 0.05) / 0.05))
    if div_yield is not None:
        div_score = 5 * math.tanh((div_yield - 0.015) / 0.01)
        if payout is not None:
            div_score -= 5 * (1 + math.tanh((payout - 0.75) / 0.1)) / 2
        score += max(-5.0, min(5.0, div_score))

    # Penalties
    if de is not None and cr is not None:
        penalty = 10 * (1 + math.tanh((de - 300) / 50)) * (1 - math.tanh((cr - 0.8) / 0.2)) / 2
        score -= penalty
    if net_margin is not None:
        score -= 7.5 * (1 - math.tanh((net_margin + 0.10) / 0.05))

    return max(0.0, min(100.0, round(score, 1)))


def _fetch_fundamental_info_batch(tickers: list[str]) -> dict[str, dict]:
    """
    Fetch yfinance .info for each ticker with rate-limit-safe sleeps.
    Returns {ticker: info_dict}.
    """
    import yfinance as yf
    results = {}
    for i, ticker in enumerate(tickers):
        log.info("  Fetching fundamentals for %s  (%d/%d)", ticker, i + 1, len(tickers))
        try:
            t = yf.Ticker(ticker)
            info = t.info or {}
            results[ticker] = info
        except Exception as e:
            log.warning("  yfinance failed for %s: %s", ticker, e)
            results[ticker] = {}
        # Respect rate limits
        if i < len(tickers) - 1:
            time.sleep(YFINANCE_SLEEP_SEC)
    return results


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def generate():
    log.info("=== Starting dataset generation ===")
    conn = _get_connection()
    log.info("Connected to database.")

    companies = _fetch_companies(conn)
    log.info("Found %d companies.", len(companies))

    # Pre-load FinBERT
    _load_finbert()

    # Batch-fetch fundamental info for all tickers
    tickers = companies["ticker"].tolist()
    log.info("Fetching fundamental data for %d tickers (with rate limiting)...", len(tickers))
    fundamental_info_map = _fetch_fundamental_info_batch(tickers)

    rows = []
    for _, company in companies.iterrows():
        cid = company["id"]
        ticker = company["ticker"]
        sector = company["sector"] or ""
        log.info("Processing %s (id=%d, sector=%s)...", ticker, cid, sector)

        # Load all market data for this company
        market_df = _fetch_market_data(conn, cid)
        if market_df.empty:
            log.warning("  No market data for %s — skipping.", ticker)
            continue

        # Determine which dates have news coverage
        news_dates = _get_unique_news_dates(conn, cid)
        if not news_dates:
            log.warning("  No news dates for %s — skipping.", ticker)
            continue

        # Compute fundamental score once (doesn't change daily)
        info = fundamental_info_map.get(ticker, {})
        fundamental_score = _compute_fundamental_score(info)

        market_dates = set(market_df.index.date)
        processed = 0
        skipped_no_forward = 0

        for eval_date in news_dates:
            # We need price at eval_date AND at eval_date + FORWARD_DAYS
            if eval_date not in market_dates:
                continue

            # Find the price FORWARD_DAYS later (or the nearest trading day after)
            forward_date = eval_date + timedelta(days=FORWARD_DAYS)
            future_prices = market_df.loc[market_df.index.date >= forward_date]
            if future_prices.empty:
                skipped_no_forward += 1
                continue

            price_now = float(market_df.loc[market_df.index.date == eval_date, "Close"].iloc[0])
            price_future = float(future_prices["Close"].iloc[0])
            label = 1 if price_future > price_now else 0

            # Technical score: use all market data up to eval_date
            history_up_to = market_df.loc[market_df.index.date <= eval_date]
            technical_score = _technical_score_from_df(history_up_to)

            # Sentiment score: news in the 7 days before eval_date
            sent_start = eval_date - timedelta(days=NEWS_LOOKBACK_DAYS)
            headlines = _fetch_news_headlines(conn, cid, sent_start, eval_date + timedelta(days=1))
            sentiment_score = _sentiment_score(headlines)

            rows.append({
                "ticker": ticker,
                "sector": sector,
                "date": eval_date.isoformat(),
                "fundamental_score": fundamental_score,
                "technical_score": technical_score,
                "sentiment_score": sentiment_score,
                "price_now": round(price_now, 2),
                "price_future": round(price_future, 2),
                "label": label,
            })
            processed += 1

        log.info(
            "  %s: %d samples generated, %d skipped (no forward price).",
            ticker, processed, skipped_no_forward,
        )

    conn.close()

    if not rows:
        log.error("No training samples generated! Check database contents.")
        return

    df = pd.DataFrame(rows)
    df.to_csv(OUTPUT_CSV, index=False)
    log.info("=== Dataset saved to %s (%d rows) ===", OUTPUT_CSV, len(df))
    log.info("Label distribution:\n%s", df["label"].value_counts().to_string())
    log.info("Score statistics:\n%s", df[["fundamental_score", "technical_score", "sentiment_score"]].describe().to_string())


if __name__ == "__main__":
    generate()
