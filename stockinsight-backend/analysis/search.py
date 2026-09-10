"""
Company search helpers for ticker and company-name suggestions.
"""
import logging
from typing import Any

import yfinance as yf

logger = logging.getLogger(__name__)

ALLOWED_QUOTE_TYPES = {
    "EQUITY",
    "ETF",
    "MUTUALFUND",
    "INDEX",
}

QUOTE_TYPE_PRIORITY = {
    "EQUITY": 0,
    "ETF": 1,
    "INDEX": 2,
    "MUTUALFUND": 3,
}


def _first_non_empty(quote: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = quote.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _normalize_quote_type(quote: dict[str, Any]) -> str:
    raw_type = _first_non_empty(quote, "quoteType", "typeDisp")
    normalized = raw_type.upper().replace(" ", "")
    if not normalized:
        return ""
    if normalized == "MUTUALFUND":
        return "Mutual Fund"
    if normalized == "ETF":
        return "ETF"
    if normalized == "INDEX":
        return "Index"
    if normalized == "EQUITY":
        return "Equity"
    return raw_type


def _normalize_text(value: str) -> str:
    return " ".join(value.strip().lower().split())


def _rank_quote(
    quote: dict[str, Any],
    query: str,
    original_index: int,
) -> tuple[int, int, int, int, str]:
    symbol = _first_non_empty(quote, "symbol").upper()
    name = _first_non_empty(quote, "shortname", "longname", "name") or symbol

    normalized_query = _normalize_text(query)
    normalized_symbol = symbol.lower()
    normalized_name = _normalize_text(name)

    if normalized_symbol == normalized_query:
        match_priority = 0
    elif normalized_name == normalized_query:
        match_priority = 1
    elif normalized_name.startswith(normalized_query):
        match_priority = 2
    elif normalized_symbol.startswith(normalized_query):
        match_priority = 3
    elif normalized_name.find(normalized_query) >= 0:
        match_priority = 4
    elif normalized_symbol.find(normalized_query) >= 0:
        match_priority = 5
    else:
        match_priority = 6

    quote_type_key = _first_non_empty(quote, "quoteType", "typeDisp").upper().replace(" ", "")
    type_priority = QUOTE_TYPE_PRIORITY.get(quote_type_key, len(QUOTE_TYPE_PRIORITY))

    return (
        match_priority,
        type_priority,
        len(symbol),
        original_index,
        normalized_name,
    )


def search_companies(query: str, limit: int = 8) -> list[dict[str, Any]]:
    clean_query = query.strip()
    if not clean_query:
        return []

    capped_limit = max(1, min(limit, 10))

    try:
        search = yf.Search(
            clean_query,
            max_results=max(capped_limit * 4, 16),
            news_count=0,
            lists_count=0,
            include_cb=False,
            enable_fuzzy_query=True,
            recommended=max(capped_limit * 4, 16),
            timeout=10,
            raise_errors=True,
        )
    except Exception:
        logger.exception("Company search failed for query=%s", clean_query)
        return []

    ranked_quotes: list[tuple[tuple[int, int, int, int, str], dict[str, Any]]] = []
    seen_symbols: set[str] = set()

    for original_index, quote in enumerate(search.quotes):
        symbol = _first_non_empty(quote, "symbol").upper()
        if not symbol or symbol in seen_symbols:
            continue

        quote_type_key = _first_non_empty(quote, "quoteType", "typeDisp").upper().replace(" ", "")
        if quote_type_key and quote_type_key not in ALLOWED_QUOTE_TYPES:
            continue

        seen_symbols.add(symbol)
        ranked_quotes.append((_rank_quote(quote, clean_query, original_index), quote))

    ranked_quotes.sort(key=lambda item: item[0])

    suggestions: list[dict[str, Any]] = []
    for _, quote in ranked_quotes[:capped_limit]:
        symbol = _first_non_empty(quote, "symbol").upper()
        name = _first_non_empty(quote, "shortname", "longname", "name") or symbol
        exchange = _first_non_empty(quote, "exchDisp", "exchange", "fullExchangeName")
        suggestions.append(
            {
                "ticker": symbol,
                "name": name,
                "exchange": exchange,
                "type": _normalize_quote_type(quote),
            }
        )

    return suggestions
