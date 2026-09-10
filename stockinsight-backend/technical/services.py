"""
Technical analysis: fetch OHLCV and indicators from yfinance, compute a 0-100 score.
"""
import logging
import time
from typing import Any

import yfinance as yf
import pandas as pd
import numpy as np

logger = logging.getLogger(__name__)

PREFERRED_MIN_POINTS = 50
ABSOLUTE_MIN_POINTS = 20
HISTORY_TIMEOUT_SECONDS = 20
HISTORY_RETRY_ATTEMPTS = 3

PERIOD_MAX_POINTS = {
    "1mo": 22,
    "3mo": 66,
    "6mo": 132,
    "1y": 252,
    "2y": 504,
    "5y": 1260,
}


def _normalize_currency(value: Any) -> str:
    if value is None:
        return "USD"
    text = str(value).strip().upper()
    return text if text else "USD"


def _resolve_ticker_currency(ticker_obj: yf.Ticker) -> str:
    try:
        fast_info = getattr(ticker_obj, "fast_info", None)
        if fast_info is not None:
            currency = None
            if isinstance(fast_info, dict):
                currency = fast_info.get("currency")
            else:
                currency = getattr(fast_info, "currency", None)
            if currency:
                return _normalize_currency(currency)
    except Exception:
        logger.debug("Unable to read fast_info currency for %s", getattr(ticker_obj, "ticker", "unknown"))

    try:
        info = ticker_obj.info or {}
        currency = info.get("currency")
        if currency:
            return _normalize_currency(currency)
    except Exception:
        logger.debug("Unable to read info currency for %s", getattr(ticker_obj, "ticker", "unknown"))

    return "USD"

def safe_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()

    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.ewm(alpha=1/period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/period, adjust=False).mean()

    rs = avg_gain / (avg_loss.replace(0, np.nan))
    rsi = 100 - (100 / (1 + rs))

    return rsi.fillna(50)  # neutral default

def safe_macd(series: pd.Series):
    ema12 = series.ewm(span=12, adjust=False).mean()
    ema26 = series.ewm(span=26, adjust=False).mean()

    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    hist = macd - signal

    return macd.fillna(0), signal.fillna(0), hist.fillna(0)

def safe_atr(df: pd.DataFrame, period: int = 14):
    high_low = df["High"] - df["Low"]
    high_close = (df["High"] - df["Close"].shift()).abs()
    low_close = (df["Low"] - df["Close"].shift()).abs()

    tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    atr = tr.rolling(period, min_periods=1).mean()

    return atr.fillna(0)

def safe_adx(df: pd.DataFrame, period: int = 14):
    high = df["High"]
    low = df["Low"]
    close = df["Close"]

    plus_dm = high.diff()
    minus_dm = -low.diff()

    plus_dm = plus_dm.where((plus_dm > minus_dm) & (plus_dm > 0), 0.0)
    minus_dm = minus_dm.where((minus_dm > plus_dm) & (minus_dm > 0), 0.0)

    tr1 = high - low
    tr2 = (high - close.shift()).abs()
    tr3 = (low - close.shift()).abs()

    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    atr = tr.rolling(period, min_periods=1).mean()

    plus_di = 100 * (plus_dm.rolling(period).sum() / atr.replace(0, np.nan))
    minus_di = 100 * (minus_dm.rolling(period).sum() / atr.replace(0, np.nan))

    dx = (abs(plus_di - minus_di) /
          (plus_di + minus_di).replace(0, np.nan)) * 100

    adx = dx.rolling(period, min_periods=1).mean()

    return adx.fillna(0)

def safe_bollinger(series: pd.Series, period: int = 20):
    sma = series.rolling(period, min_periods=1).mean()
    std = series.rolling(period, min_periods=1).std()

    upper = sma + (2 * std)
    lower = sma - (2 * std)

    return sma.fillna(series), upper.fillna(series), lower.fillna(series)

def safe_volume_spike(df: pd.DataFrame, period: int = 20, multiplier: float = 1.5):
    avg_volume = df["Volume"].rolling(period, min_periods=1).mean()

    latest_volume = df["Volume"].iloc[-1]
    latest_avg = avg_volume.iloc[-1]

    if latest_avg <= 0:
        return False

    return (latest_volume / latest_avg) > multiplier

def safe_support_resistance(df: pd.DataFrame, window: int = 5):
    supports = []
    resistances = []

    for i in range(window, len(df) - window):
        low = df["Low"].iloc[i]
        high = df["High"].iloc[i]

        if low == df["Low"].iloc[i-window:i+window+1].min():
            supports.append(low)

        if high == df["High"].iloc[i-window:i+window+1].max():
            resistances.append(high)

    return supports[-3:], resistances[-3:]

def safe_breakout(df: pd.DataFrame, lookback: int = 20):
    if len(df) < lookback + 1:
        return None

    recent_high = df["High"].tail(lookback).max()
    recent_low = df["Low"].tail(lookback).min()
    close = df["Close"].iloc[-1]

    if close > recent_high:
        return "Bullish Breakout"
    elif close < recent_low:
        return "Bearish Breakdown"
    return None

def safe_fibonacci(df: pd.DataFrame, lookback: int = 100):
    if len(df) < lookback:
        lookback = len(df)

    recent_data = df.tail(lookback)

    high = recent_data["High"].max()
    low = recent_data["Low"].min()

    diff = high - low

    if diff <= 0:
        return {}

    return {
        "0.236": high - 0.236 * diff,
        "0.382": high - 0.382 * diff,
        "0.5": high - 0.5 * diff,
        "0.618": high - 0.618 * diff,
        "0.786": high - 0.786 * diff,
    }


def _period_fetch_candidates(period: str) -> tuple[str, ...]:
    if period == "1mo":
        return ("1mo", "3mo", "6mo", "1y")
    if period == "3mo":
        return ("3mo", "6mo", "1y")
    if period == "6mo":
        return ("6mo", "1y")
    return (period,)


def _fetch_history_once(
    ticker_obj: yf.Ticker,
    period: str,
    timeout_seconds: int,
) -> pd.DataFrame:
    try:
        return ticker_obj.history(
            period=period,
            auto_adjust=True,
            timeout=timeout_seconds,
        )
    except TypeError:
        # Compatibility fallback for yfinance versions that do not accept timeout.
        return ticker_obj.history(period=period, auto_adjust=True)


def _fetch_history_with_retry(ticker_obj: yf.Ticker, period: str) -> pd.DataFrame:
    last_error: Exception | None = None
    symbol = getattr(ticker_obj, "ticker", "unknown")

    for attempt in range(1, HISTORY_RETRY_ATTEMPTS + 1):
        try:
            df = _fetch_history_once(ticker_obj, period, HISTORY_TIMEOUT_SECONDS)
            if df is None:
                df = pd.DataFrame()
            if not df.empty:
                return df
            logger.warning(
                "Empty price history for %s period=%s (attempt %s/%s)",
                symbol,
                period,
                attempt,
                HISTORY_RETRY_ATTEMPTS,
            )
        except Exception as exc:
            last_error = exc
            logger.warning(
                "Price history fetch failed for %s period=%s (attempt %s/%s): %s",
                symbol,
                period,
                attempt,
                HISTORY_RETRY_ATTEMPTS,
                exc,
            )

        if attempt < HISTORY_RETRY_ATTEMPTS:
            time.sleep(min(2 * attempt, 5))

    if last_error is not None:
        raise last_error
    return pd.DataFrame()


def _load_history_frame(ticker_obj: yf.Ticker, requested_period: str) -> pd.DataFrame:
    fallback_df = pd.DataFrame()
    last_error: Exception | None = None
    symbol = getattr(ticker_obj, "ticker", "unknown")

    for candidate_period in _period_fetch_candidates(requested_period):
        try:
            candidate_df = _fetch_history_with_retry(ticker_obj, candidate_period).dropna()
        except Exception as exc:
            last_error = exc
            continue

        if candidate_df.empty:
            continue

        if fallback_df.empty:
            fallback_df = candidate_df

        if len(candidate_df) >= PREFERRED_MIN_POINTS:
            if candidate_period != requested_period:
                logger.info(
                    "Using fallback period=%s for %s requested_period=%s rows=%s",
                    candidate_period,
                    symbol,
                    requested_period,
                    len(candidate_df),
                )
            return candidate_df

    if not fallback_df.empty and len(fallback_df) >= ABSOLUTE_MIN_POINTS:
        logger.info(
            "Using short history for %s requested_period=%s rows=%s",
            symbol,
            requested_period,
            len(fallback_df),
        )
        return fallback_df

    if last_error is not None:
        raise last_error
    return pd.DataFrame()

def smooth_centered(value: float, center: float, scale: float) -> float:
    """Returns a value smoothly scaled between -1 and +1 via tanh."""
    return np.tanh((value - center) / scale)


def detect_regime(adx: float, atr: float, close: float) -> str:
    if close <= 0:
        return "Unknown"
    vol_ratio = atr / close
    if adx > 25 and vol_ratio < 0.05:
        return "Trending"
    elif adx < 20:
        return "Sideways"
    else:
        return "Volatile"


def score_engine(
    close: float,
    sma20: float,
    sma50: float,
    sma200: float,
    rsi: float,
    macd: float,
    macd_signal: float,
    adx: float,
    atr: float,
    volume_spike: bool,
    breakout_signal: str | None,
    # Optional: pass the raw volume ratio for proportional volume scoring
    volume_ratio: float | None = None,
) -> dict:

    if close <= 0:
        return {"score": 50, "signal": "Neutral", "reasons": ["Invalid price"]}

    regime = detect_regime(adx, atr, close)
    score = 0.0
    reasons = []

    # ─────────────────────────────────────────────
    # 1. Long-Term Trend  (weight: 20)
    #    FIX: scale widened from 0.02 → 0.04 so the
    #    SMA gap needs a bigger move to saturate.
    # ─────────────────────────────────────────────
    trend_strength = (sma50 - sma200) / close
    trend_component = smooth_centered(trend_strength, 0, 0.04)   # was 0.02
    score += 20 * trend_component

    if trend_component > 0.1:
        reasons.append("Long-term uptrend")
    elif trend_component < -0.1:
        reasons.append("Long-term downtrend")

    # ─────────────────────────────────────────────
    # 2. Short-Term Position  (weight: 10)
    #    FIX: scale widened from 1% → 3% of close.
    #    A single small candle won't saturate this.
    # ─────────────────────────────────────────────
    short_component = smooth_centered(close - sma20, 0, close * 0.03)  # was 0.01
    score += 10 * short_component

    # ─────────────────────────────────────────────
    # 3. RSI — Regime-Aware  (weight: 12)
    #    FIX: both scales widened (15 / 12 → was 10 / 7).
    #    A 2-point RSI move barely registers now.
    # ─────────────────────────────────────────────
    if regime == "Trending":
        rsi_component = smooth_centered(rsi, 50, 15)   # was 10
    else:
        rsi_component = smooth_centered(rsi, 50, 12)   # was 7

    score += 12 * rsi_component

    # ─────────────────────────────────────────────
    # 4. MACD Strength  (weight: 12)
    #    FIX: scale widened from 0.002 → 0.004.
    # ─────────────────────────────────────────────
    macd_strength = (macd - macd_signal) / close
    macd_component = smooth_centered(macd_strength, 0, 0.004)   # was 0.002
    score += 12 * macd_component

    # ─────────────────────────────────────────────
    # 5. Trend Strength Adjustment
    #    FIX: replaced multiplicative amplifier with
    #    an additive regime bonus (±3 pts max).
    #    Original: score *= (1 + 0.3 * multiplier)
    #    compounded every component's error; now it's
    #    just a small flat nudge based on ADX.
    # ─────────────────────────────────────────────
    # Use continuous scaling for trend bonus
    regime_bonus = 1.5 * (1 + smooth_centered(adx, 37.5, 12.5))
    if adx > 25:
        score += regime_bonus if score >= 0 else -regime_bonus
        reasons.append("Strong trend")
    
    # Smooth dampening for weak trend
    dampen_factor = 1.0 - 0.1 * (1 - smooth_centered(adx, 15.0, 5.0)) / 2
    score *= dampen_factor

    # ─────────────────────────────────────────────
    # 6. Breakout Signal
    #    FIX: require a confirmation margin (0.5% of
    #    close) so a 1-tick breach doesn't fire ±8.
    #    Also dampen outside a confirmed trend.
    # ─────────────────────────────────────────────
    BREAKOUT_MARGIN = close * 0.005   # 0.5% confirmation buffer

    if breakout_signal:   # act smoothly when there's some trend
        # Smooth weight based on ADX (stronger trend -> higher weight, from ~4 to ~8)
        bo_weight = 4 + 4 * (1 + smooth_centered(adx, 25.0, 10.0)) / 2
        # Only apply full breakout if trend has some strength (adx > 15-20 smoothly)
        bo_confidence = (1 + smooth_centered(adx, 20.0, 5.0)) / 2
        bo_effective_weight = bo_weight * bo_confidence
        
        if bo_effective_weight > 2:
            if breakout_signal == "Bullish Breakout":
                score += bo_effective_weight
                reasons.append("Bullish breakout")
            elif breakout_signal == "Bearish Breakdown":
                score -= bo_effective_weight
                reasons.append("Bearish breakdown")

    # ─────────────────────────────────────────────
    # 7. Volume
    #    FIX: proportional contribution (0–5 pts)
    #    instead of binary on/off.
    #    Pass volume_ratio = latest_vol / avg_vol.
    #    Falls back to old binary if not provided.
    # ─────────────────────────────────────────────
    if volume_ratio is not None and volume_ratio > 0:
        # Smoothly ramp from 0 → 5 pts as ratio goes 1 → 3+
        vol_component = smooth_centered(volume_ratio, 1.0, 0.8)   # centre=1, scale=0.8
        vol_pts = 5 * max(vol_component, 0)   # only positive (spike = bullish confirmation)
        score += vol_pts
        if vol_component > 0.3:
            reasons.append("Volume expansion")
    elif volume_spike:
        score += 3   # reduced from 5; binary fallback
        reasons.append("Volume expansion")

    # ─────────────────────────────────────────────
    # 8. Volatility Risk Adjustment
    #    FIX: scale widened (0.02 → 0.03) so normal
    #    daily ATR fluctuation is less punishing.
    # ─────────────────────────────────────────────
    vol_ratio_price = atr / close
    score -= smooth_centered(vol_ratio_price, 0.03, 0.03) * 10   # scale was 0.02

    # ─────────────────────────────────────────────
    # Normalise to 0–100
    # ─────────────────────────────────────────────
    final_score = 50 + score
    final_score = max(0, min(100, round(final_score, 1)))

    if final_score >= 70:
        signal = "Strong Bullish"
    elif final_score >= 55:
        signal = "Bullish"
    elif final_score >= 45:
        signal = "Neutral"
    elif final_score >= 30:
        signal = "Bearish"
    else:
        signal = "Strong Bearish"

    return {
        "score": final_score,
        "signal": signal,
        "regime": regime,
        "reasons": reasons,
    }
def get_chart_data(ticker: str, duration: str) -> dict[str, Any]:
    try:
        ticker = ticker.upper().strip()
        t = yf.Ticker(ticker)
        currency = _resolve_ticker_currency(t)

        period = "1y"
        interval = "1d"

        duration = duration.upper()
        if duration == "1D":
            period = "1d"
            interval = "5m"
        elif duration == "5D":
            period = "5d"
            interval = "15m"
        elif duration == "1M":
            period = "1mo"
            interval = "1h"
        elif duration == "6M":
            period = "6mo"
            interval = "1d"
        elif duration == "YTD":
            period = "ytd"
            interval = "1d"
        elif duration == "1Y":
            period = "1y"
            interval = "1d"
        elif duration == "5Y":
            period = "5y"
            interval = "1wk"
        elif duration == "ALL":
            period = "max"
            interval = "1mo"

        df = t.history(period=period, interval=interval, auto_adjust=True)
        if df is None or df.empty:
            return {"ohlcv": [], "currency": currency}

        ohlcv = [
            {
                "date": d.strftime("%Y-%m-%dT%H:%M:%S%z") if hasattr(d, "strftime") else str(d),
                "open": round(float(row["Open"]), 2),
                "high": round(float(row["High"]), 2),
                "low": round(float(row["Low"]), 2),
                "close": round(float(row["Close"]), 2),
                "volume": int(row["Volume"]),
            }
            for d, row in df.iterrows()
        ]
        return {"ohlcv": ohlcv, "currency": currency}
    except Exception as e:
        logger.exception("Chart data fetch failed for %s duration=%s: %s", ticker, duration, e)
        return {"ohlcv": [], "currency": "USD"}

DEFAULT_ANALYSIS_PERIOD = "1y"


def get_technical_analysis(ticker: str) -> dict | None:
    try:
        ticker = ticker.upper().strip()
        t = yf.Ticker(ticker)
        currency = _resolve_ticker_currency(t)

        df = _load_history_frame(t, DEFAULT_ANALYSIS_PERIOD)

        if df is None or df.empty:
            return None

        close = df["Close"]

        # =========================
        # Compute Indicators
        # =========================
        rsi_series = safe_rsi(close)
        macd, macd_signal, _ = safe_macd(close)
        adx_series = safe_adx(df)
        atr_series = safe_atr(df)

        sma20 = close.rolling(20, min_periods=1).mean()
        sma50 = close.rolling(50, min_periods=1).mean()
        sma200 = close.rolling(200, min_periods=1).mean()

        volume_spike = bool(safe_volume_spike(df))
        breakout_signal = safe_breakout(df)
        breakout_signal = str(breakout_signal) if breakout_signal else None
        support, resistance = safe_support_resistance(df)
        fib_levels = safe_fibonacci(df)

        # =========================
        # Extract Latest Values
        # =========================
        last_close = float(close.iloc[-1])
        last_sma20 = float(sma20.iloc[-1])
        last_sma50 = float(sma50.iloc[-1])
        last_sma200 = float(sma200.iloc[-1])
        last_rsi = float(rsi_series.iloc[-1])
        last_macd = float(macd.iloc[-1])
        last_macd_signal = float(macd_signal.iloc[-1])
        last_adx = float(adx_series.iloc[-1])
        last_atr = float(atr_series.iloc[-1])

        # 52-week range from history (stable)
        low52 = float(df["Low"].tail(252).min())
        high52 = float(df["High"].tail(252).max())

        # =========================
        # Trend Classification
        # =========================
        if last_sma50 > last_sma200 and last_close > last_sma50:
            trend = "Bullish"
        elif last_sma50 < last_sma200 and last_close < last_sma50:
            trend = "Bearish"
        else:
            trend = "Sideways"

        # =========================
        # Score Calculation
        # =========================
        score_result = score_engine(
            close=last_close,
            sma20=last_sma20,
            sma50=last_sma50,
            sma200=last_sma200,
            rsi=last_rsi,
            macd=last_macd,
            macd_signal=last_macd_signal,
            adx=last_adx,
            atr=last_atr,
            volume_spike=volume_spike,
            breakout_signal=breakout_signal,
        )

        # =========================
        # OHLCV for Chart (last 252)
        # =========================
        max_points = PERIOD_MAX_POINTS.get(DEFAULT_ANALYSIS_PERIOD, 252)
        hist_tail = df.tail(max_points)

        ohlcv = [
            {
                "date": d.strftime("%Y-%m-%d"),
                "open": round(float(row["Open"]), 2),
                "high": round(float(row["High"]), 2),
                "low": round(float(row["Low"]), 2),
                "close": round(float(row["Close"]), 2),
                "volume": int(row["Volume"]),
            }
            for d, row in hist_tail.iterrows()
        ]

        # =========================
        # Final Output
        # =========================
        return {
            "symbol": ticker,
            "currency": currency,
            "trend": trend,
            "score": score_result["score"],
            "signal": score_result["signal"],
            "reasons": score_result["reasons"],
            "indicators": {
                "close": round(last_close, 2),
                "RSI": round(last_rsi, 2),
                "MACD": round(last_macd, 4),
                "MACD_signal": round(last_macd_signal, 4),
                "ADX": round(last_adx, 2),
                "ATR": round(last_atr, 2),
                "SMA20": round(last_sma20, 2),
                "SMA50": round(last_sma50, 2),
                "SMA200": round(last_sma200, 2),
                "52WeekLow": round(low52, 2),
                "52WeekHigh": round(high52, 2),
            },
            "structure": {
                "support": support,
                "resistance": resistance,
                "breakout": breakout_signal,
                "volumeSpike": volume_spike,
                "fibonacciLevels": fib_levels,
            },
            "ohlcv": ohlcv,
        }

    except Exception as e:
        logger.exception("Technical analysis failed for %s: %s", ticker, e)
        return None
