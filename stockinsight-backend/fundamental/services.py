"""
Fundamental analysis: fetch company/financial data from yfinance and compute a 0-100 score.
"""
import os
import logging
import math
import concurrent.futures
from typing import Any

from dotenv import load_dotenv
import pandas as pd
import requests
import yfinance as yf

logger = logging.getLogger(__name__)

_SP500_CACHE = None

def _get_sector_peers(sector: str, industry: str, exclude_ticker: str, max_peers: int = 15) -> list[str]:
    load_dotenv()
    finnhub_key = os.getenv("FINNHUB_API_KEY")
    if finnhub_key:
        try:
            url = f"https://finnhub.io/api/v1/stock/peers?symbol={exclude_ticker.upper()}&token={finnhub_key}"
            res = requests.get(url, timeout=5)
            if res.status_code == 200:
                data = res.json()
                if isinstance(data, list) and len(data) > 0:
                    peers = [p for p in data if isinstance(p, str) and p.upper() != exclude_ticker.upper()]
                    if peers:
                        return peers[:max_peers]
        except Exception as e:
            logger.warning("Finnhub peers fetch failed: %s", e)

    global _SP500_CACHE
    if _SP500_CACHE is None:
        try:
            url = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv"
            _SP500_CACHE = pd.read_csv(url)
        except Exception as e:
            logger.warning("Failed to fetch S&P 500 list from CSV: %s", e)
            return []
            
    try:
        df = _SP500_CACHE
        peers = []
        if industry:
            peers = df[df["GICS Sub-Industry"].str.contains(industry, case=False, na=False)]["Symbol"].tolist()
        
        if len(peers) < 3 and sector:
            search_sector = "Information Technology" if "tech" in sector.lower() else sector
            peers = df[df["GICS Sector"].str.contains(search_sector, case=False, na=False)]["Symbol"].tolist()
            
        peers = [p for p in peers if p.upper() != exclude_ticker.upper()]
        return peers[:max_peers]
    except Exception as e:
        logger.warning("Error filtering peers: %s", e)
    return []

def _fetch_pe_for_ticker(ticker: str) -> dict:
    try:
        t = yf.Ticker(ticker)
        pe = t.info.get("trailingPE")
        fpe = t.info.get("forwardPE")
        return {"ticker": ticker, "trailingPE": float(pe) if pe is not None else None, "forwardPE": float(fpe) if fpe is not None else None}
    except Exception:
        return {"ticker": ticker, "trailingPE": None, "forwardPE": None}

def _calculate_relative_standing(raw: float | None, mean: float | None) -> dict:
    if raw is None or mean is None or mean <= 0:
        return {"score": 0, "label": "N/A"}
    
    diff = (raw - mean) / mean
    score = math.tanh(diff)  # -1 to 1
    
    # For P/E, lower is "Undervalued", higher is "Overvalued"
    if score < -0.2:
        label = "Undervalued"
    elif score > 0.2:
        label = "Overvalued"
    else:
        label = "Fairly Valued"
        
    return {"score": round(score, 2), "label": label}


def _safe_get(info: dict, *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in info and info[key] is not None:
            return info[key]
    return default


def _normalize_percentage(val: Any, is_yield: bool = False) -> float | None:
    """
    yfinance is inconsistent with percentage units.
    Sometimes it returns 0.015 for 1.5%, sometimes 1.5.
    This helper tries to normalize to decimal format (0.015 for 1.5%).
    """
    if val is None:
        return None
    try:
        f_val = float(val)
        # Threshold for yields is lower as they are rarely > 10% (0.1) as decimals
        # while growth can easily be > 1.0 (100%).
        threshold = 0.05 if is_yield else 0.8
        
        if abs(f_val) > threshold:
            # If it's already a whole number (e.g. 1.5 for 1.5%), divide by 100
            return f_val / 100.0
        return f_val
    except (ValueError, TypeError):
        return None


def _compute_fundamental_score(info: dict, sector_pe_data: dict | None = None) -> float:
    """
    Compute a 0-100 fundamental score from key metrics, 
    with scope-safe extraction and strict sector-based health logic.
    """
    score = 0.0

    # ==========================================
    # 1. EXTRACT & PRE-CALCULATE ALL VARIABLES
    # ==========================================
    sector = _safe_get(info, "sector", default="")
    is_financial = (sector == "Financial Services")

    # Core Metrics
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
    
    # PE Fallback
    pe = _safe_get(info, "trailingPE")
    if pe is None:
        pe = _safe_get(info, "forwardPE")
    if pe is None and current_price is not None and eps is not None and eps > 0:
        pe = current_price / eps

    # PEG Fallback
    peg = _safe_get(info, "pegRatio")
    if peg is None and pe is not None and eps_growth is not None and eps_growth > 0:
         peg = pe / (eps_growth * 100)

    # ROE Fallback
    roe = _safe_get(info, "returnOnEquity")
    if roe is None and eps is not None and current_price is not None and pb_ratio is not None and current_price > 0:
        book_value_per_share = current_price / pb_ratio
        if book_value_per_share > 0:
             roe = eps / book_value_per_share
             
    # Liquidity Fallbacks
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

    # ==========================================
    # 2. APPLY SCORING LOGIC
    # ==========================================
    
    # --- Pillar 1: Valuation (Max 30) ---
    if peg is not None and peg > 0:
        score += 5 * (1 - math.tanh((peg - 1.25) / 0.25))
    
    # P/E scoring: prefer sector-normalised relative standing over raw thresholds
    if sector_pe_data is not None:
        trailing_standing_score = sector_pe_data.get("trailing", {}).get("relativeStandingScore")
        forward_standing_score = sector_pe_data.get("forward", {}).get("relativeStandingScore")
        # Use trailing if available, else forward. Score is tanh in [-1, 1]:
        norm_score = trailing_standing_score if trailing_standing_score is not None else forward_standing_score
        if norm_score is not None:
            score += 5 * (1 - math.tanh(norm_score * 2.5))
    elif pe is not None and pe > 0:
        # Fallback: raw thresholds when no sector data
        score += 5 * (1 - math.tanh((pe - 20) / 5))

    if pb_ratio is not None and pb_ratio > 0:
        score += 5 * (1 - math.tanh((pb_ratio - 2.25) / 0.75))

    # --- Pillar 2: Profitability & Efficiency (Max 30) ---
    if roe is not None:
        score += 5 * (1 + math.tanh((roe - 0.115) / 0.035))

    if op_margin is not None:
        score += 5 * (1 + math.tanh((op_margin - 0.10) / 0.05))

    if net_margin is not None:
        score += 5 * (1 + math.tanh((net_margin - 0.075) / 0.025))

    # --- Pillar 3: Financial Health & Liquidity (Max 25) ---
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

    # --- Pillar 4: Growth & Dividends (Max 15) ---
    if rev_growth is not None:
        score += 2.5 * (1 + math.tanh((rev_growth - 0.05) / 0.05))

    if eps_growth is not None:
        score += 2.5 * (1 + math.tanh((eps_growth - 0.05) / 0.05))
    
    if div_yield is not None:
        div_score = 5 * math.tanh((div_yield - 0.015) / 0.01)
        if payout is not None:
            div_score -= 5 * (1 + math.tanh((payout - 0.75) / 0.1)) / 2
        score += max(-5.0, min(5.0, div_score))

    # ==========================================
    # 3. APPLY PENALTIES
    # ==========================================
    if de is not None and cr is not None:
        penalty = 10 * (1 + math.tanh((de - 300) / 50)) * (1 - math.tanh((cr - 0.8) / 0.2)) / 2
        score -= penalty
    
    if net_margin is not None:
        score -= 7.5 * (1 - math.tanh((net_margin + 0.10) / 0.05))

    valuation_score = 0
    if peg is not None and peg > 0: 
        valuation_score += 5 * (1 - math.tanh((peg - 1.25) / 0.25))
    
    # Mirror the sector-normalised P/E logic used in scoring above
    if sector_pe_data is not None:
        trailing_standing_score = sector_pe_data.get("trailing", {}).get("relativeStandingScore")
        forward_standing_score = sector_pe_data.get("forward", {}).get("relativeStandingScore")
        norm_score = trailing_standing_score if trailing_standing_score is not None else forward_standing_score
        if norm_score is not None:
            valuation_score += 5 * (1 - math.tanh(norm_score * 2.5))
    elif pe is not None and pe > 0:
        valuation_score += 5 * (1 - math.tanh((pe - 20) / 5))
        
    if pb_ratio is not None and pb_ratio > 0: 
        valuation_score += 5 * (1 - math.tanh((pb_ratio - 2.25) / 0.75))

    if valuation_score >= 15 and rev_growth is not None and rev_growth < 0:
        score -= 5 * (1 - math.tanh(rev_growth / 0.05))

    return max(0.0, min(100.0, round(score, 1)))

def get_fundamental_analysis(ticker: str) -> dict[str, Any] | None:
    """
    Fetch fundamental data from yfinance and compute fundamental score (0-100).
    Returns None if ticker invalid or fetch fails.
    """
    try:
        t = yf.Ticker(ticker.upper().strip())
        info = t.info
        if not info or "symbol" not in info:
            return None

        sector_str = _safe_get(info, "sector", default="")
        industry_str = _safe_get(info, "industry", default="")
        
        # Calculate PEG fallback
        pe_val = _safe_get(info, "trailingPE")
        eps_growth_val = _safe_get(info, "earningsGrowth")
        peg_fallback = _safe_get(info, "pegRatio")
        if peg_fallback is None and pe_val is not None and eps_growth_val is not None and eps_growth_val > 0:
            peg_fallback = pe_val / (eps_growth_val * 100)

        # Calculate ROCE fallback
        roce_fallback = _safe_get(info, "returnOnCapitalEmployed", default=None)
        if roce_fallback is None:
            try:
                inc = t.income_stmt
                bs = t.balance_sheet
                ebit = inc.loc["EBIT"].iloc[0] if "EBIT" in inc.index else None
                total_assets = bs.loc["Total Assets"].iloc[0] if "Total Assets" in bs.index else None
                current_liab = bs.loc["Current Liabilities"].iloc[0] if "Current Liabilities" in bs.index else None
                if ebit is not None and total_assets is not None and current_liab is not None:
                    capital_employed = total_assets - current_liab
                    if capital_employed > 0:
                        roce_fallback = ebit / capital_employed
            except Exception:
                pass

        data = {
            # Identification
            "symbol": _safe_get(info, "symbol", default=ticker.upper()),
            "shortName": _safe_get(info, "shortName", "longName", default=ticker.upper()),
            "longName": _safe_get(info, "longName", "shortName", default=""),
            "sector": _safe_get(info, "sector"),
            "industry": _safe_get(info, "industry"),
            "exchange": _safe_get(info, "exchange"),
            "fullExchangeName": _safe_get(info, "fullExchangeName"),
            "website": _safe_get(info, "website"),
            "description": _safe_get(info, "longBusinessSummary"),

            # Price & Market Data
            "currentPrice": _safe_get(info, "currentPrice", "regularMarketPrice"),
            "currency": _safe_get(info, "currency", default="USD"),
            "marketCap": _safe_get(info, "marketCap"),
            "enterpriseValue": _safe_get(info, "enterpriseValue") or (
                (_safe_get(info, "marketCap") or 0) + 
                (_safe_get(info, "totalDebt") or 0) - 
                (_safe_get(info, "totalCash") or 0)
            ) or None,
            "beta": _safe_get(info, "beta"),

            # Valuation Metrics
            "trailingPE": _safe_get(info, "trailingPE"),
            "forwardPE": _safe_get(info, "forwardPE"),
            "pegRatio": peg_fallback,
            "priceToBook": _safe_get(info, "priceToBook"),
            "priceToSalesTrailing12Months": _safe_get(info, "priceToSalesTrailing12Months"),
            "enterpriseToEbitda": _safe_get(info, "enterpriseToEbitda"),

            # Profitability & Margins
            "trailingEps": _safe_get(info, "trailingEps"),
            "forwardEps": _safe_get(info, "forwardEps"),
            "returnOnEquity": _safe_get(info, "returnOnEquity"),
            "returnOnAssets": _safe_get(info, "returnOnAssets"),
            "returnOnCapitalEmployed": roce_fallback,
            "grossMargins": _safe_get(info, "grossMargins"),
            "operatingMargins": _safe_get(info, "operatingMargins"),
            "profitMargins": _safe_get(info, "profitMargins"),

            # Financial Health & Cash Flow
            "debtToEquity": _safe_get(info, "debtToEquity"),
            "currentRatio": _safe_get(info, "currentRatio"),
            "quickRatio": _safe_get(info, "quickRatio"),
            "interestCoverage": _safe_get(info, "interestCoverage"),
            "totalCash": _safe_get(info, "totalCash"),
            "totalDebt": _safe_get(info, "totalDebt"),
            "freeCashflow": _safe_get(info, "freeCashflow"),
            "operatingCashflow": _safe_get(info, "operatingCashflow"),

            # Growth
            "revenueGrowth": _normalize_percentage(_safe_get(info, "revenueGrowth")),
            "earningsGrowth": _normalize_percentage(_safe_get(info, "earningsGrowth")),
            "revenuePerShare": _safe_get(info, "revenuePerShare"),

            # Dividends
            "dividendYield": (
                _safe_get(info, "dividendRate") / _safe_get(info, "currentPrice", "regularMarketPrice")
                if _safe_get(info, "dividendRate") and _safe_get(info, "currentPrice", "regularMarketPrice")
                else _normalize_percentage(_safe_get(info, "dividendYield"), is_yield=True)
            ),
            "dividendRate": _safe_get(info, "dividendRate"),
            "payoutRatio": _safe_get(info, "payoutRatio"),

            # Price History & Volume
            "52WeekHigh": _safe_get(info, "fiftyTwoWeekHigh"),
            "52WeekLow": _safe_get(info, "fiftyTwoWeekLow"),
            "averageVolume": _safe_get(info, "averageVolume"),
            "volume": _safe_get(info, "volume"),

            # Analyst Sentiment
            "targetMeanPrice": _safe_get(info, "targetMeanPrice"),
            "recommendationKey": _safe_get(info, "recommendationKey"),
            "numberOfAnalystOpinions": _safe_get(info, "numberOfAnalystOpinions"),
        }

        # Chart Trends Fetching
        try:
            import pandas as pd

            def _find_row_value(df, col, *label_options):
                """Try multiple row label names and return the first valid value."""
                for label in label_options:
                    if label in df.index:
                        val = df.loc[label, col]
                        if pd.notna(val):
                            return float(val)
                return None

            inc = t.income_stmt
            revenue_trend = []
            margins_trend = []
            if inc is not None and not inc.empty:
                for col in list(inc.columns)[:5]:
                    year = col.year if hasattr(col, 'year') else str(col)
                    
                    rev_val = _find_row_value(inc, col,
                        'Total Revenue', 'TotalRevenue', 'Revenue',
                        'Total Net Revenue', 'Gross Revenue')
                    net_val = _find_row_value(inc, col,
                        'Net Income', 'NetIncome',
                        'Net Income Common Stockholders',
                        'Net Income Common Stockholders Including Extraordinary Items',
                        'NetIncomeCommonStockholders')
                    op_val = _find_row_value(inc, col,
                        'Operating Income', 'OperatingIncome',
                        'Operating Revenue', 'EBIT',
                        'Earnings Before Interest And Taxes')
                    
                    revenue_trend.append({"year": year, "revenue": rev_val, "netProfit": net_val})
                    
                    # Calculate margins manually to ensure historical accuracy 
                    op_margin = (op_val / rev_val) if (op_val is not None and rev_val is not None and rev_val > 0) else None
                    net_margin = (net_val / rev_val) if (net_val is not None and rev_val is not None and rev_val > 0) else None
                    margins_trend.append({
                        "year": year, 
                        "operatingMargin": op_margin, 
                        "netMargin": net_margin
                    })
        except Exception as e:
            logger.warning("Error fetching income stmt: %s", e)
            revenue_trend = []
            margins_trend = []

        try:
            cf = t.cashflow
            cashflow_trend = []
            if cf is not None and not cf.empty:
                for col in list(cf.columns)[:5]:
                    year = col.year if hasattr(col, 'year') else str(col)
                    op_val = _find_row_value(cf, col,
                        'Operating Cash Flow', 'OperatingCashFlow',
                        'Cash Flow From Continuing Operating Activities',
                        'Total Cash From Operating Activities')
                    fcf_val = _find_row_value(cf, col,
                        'Free Cash Flow', 'FreeCashFlow',
                        'Free Cash Flow From Equity')
                    cashflow_trend.append({"year": year, "operatingCashFlow": op_val, "freeCashFlow": fcf_val})
        except Exception as e:
            logger.warning("Error fetching cashflow: %s", e)
            cashflow_trend = []
            
        try:
            holders = t.major_holders
            shareholding_pattern = {}
            if holders is not None and not holders.empty and 'Value' in holders.columns:
                insiders = holders.loc['insidersPercentHeld', 'Value'] if 'insidersPercentHeld' in holders.index else 0
                institutions = holders.loc['institutionsPercentHeld', 'Value'] if 'institutionsPercentHeld' in holders.index else 0
                import pandas as pd
                ins = float(insiders) if pd.notna(insiders) else 0
                inst = float(institutions) if pd.notna(institutions) else 0
                pub = max(0.0, 1.0 - ins - inst)
                shareholding_pattern = {
                    "promoters": ins,
                    "institutions": inst,
                    "public": pub
                }
        except Exception as e:
            logger.warning("Error fetching holders: %s", e)
            shareholding_pattern = {}

        data["revenueTrend"] = revenue_trend[::-1] if revenue_trend else [] # Oldest to newest
        data["marginsTrend"] = margins_trend[::-1] if margins_trend else []
        data["cashflowTrend"] = cashflow_trend[::-1] if cashflow_trend else []
        data["shareholdingPattern"] = shareholding_pattern

        # Sector P/E Normalization — computed BEFORE scoring so normalised values feed into the score
        sector_peers = _get_sector_peers(sector_str, industry_str, ticker, max_peers=15)
        sector_pe_analysis = None
        if sector_peers:
            with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                peer_results = list(executor.map(_fetch_pe_for_ticker, sector_peers))

            valid_trailing = [p["trailingPE"] for p in peer_results if p["trailingPE"] is not None and p["trailingPE"] > 0]
            valid_forward = [p["forwardPE"] for p in peer_results if p["forwardPE"] is not None and p["forwardPE"] > 0]

            mean_trailing = sum(valid_trailing) / len(valid_trailing) if valid_trailing else None
            mean_forward = sum(valid_forward) / len(valid_forward) if valid_forward else None

            ticker_trailing = _safe_get(info, "trailingPE")
            ticker_forward = _safe_get(info, "forwardPE")

            trailing_standing = _calculate_relative_standing(ticker_trailing, mean_trailing)
            forward_standing = _calculate_relative_standing(ticker_forward, mean_forward)

            sector_pe_analysis = {
                "peers": sector_peers,
                "trailing": {
                    "rawValue": ticker_trailing,
                    "sectorMean": mean_trailing,
                    "relativeStandingScore": trailing_standing["score"],
                    "relativeStandingLabel": trailing_standing["label"],
                },
                "forward": {
                    "rawValue": ticker_forward,
                    "sectorMean": mean_forward,
                    "relativeStandingScore": forward_standing["score"],
                    "relativeStandingLabel": forward_standing["label"],
                }
            }

        data["sectorPeersAnalysis"] = sector_pe_analysis

        # Pass sector P/E analysis into scorer so it uses normalised standing
        score = _compute_fundamental_score(info, sector_pe_data=sector_pe_analysis)
        return {
            "data": data,
            "score": score,
        }
    except Exception as e:
        logger.exception("get_fundamental_analysis failed for %s: %s", ticker, e)
        return None
