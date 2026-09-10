"""
LLM report generation: produce sectioned summaries using Gemini with
Groq/OpenAI-compatible and deterministic fallbacks.
"""
import json
import logging
import math
import os
import re
from typing import Any

from dotenv import load_dotenv
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)


ReportSections = dict[str, str]
ReportBundle = dict[str, Any]
_DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"
_MAX_PROMPT_HEADLINES = 30
_MAX_PROMPT_HEADLINE_CHARS = 140
_DEFAULT_GROQ_MAX_COMPLETION_TOKENS = 1800
_MAX_GROQ_RETRY_COMPLETION_TOKENS = 2600


def _resolve_report_llm_provider() -> str:
    """
    Supported values:
    - auto (default): Gemini first, then Groq fallback
    - gemini: Gemini only
    - groq: Groq only (skip Gemini entirely)
    """
    raw = (os.getenv("REPORT_LLM_PROVIDER") or "auto").strip().lower()
    if raw in {"auto", "gemini", "groq"}:
        return raw
    logger.warning("Invalid REPORT_LLM_PROVIDER=%r; defaulting to 'auto'.", raw)
    return "auto"


def _get_gemini_client() -> genai.Client | None:
    """Initialise Gemini client from GEMINI_API_KEY."""
    load_dotenv()
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        logger.warning("GEMINI_API_KEY not set; using fallback section summaries.")
        return None
    try:
        return genai.Client(api_key=api_key)
    except Exception as exc:
        logger.warning("Failed to initialise Gemini client: %s", exc)
        return None


def _generate_report_bundle_with_groq(prompt: str, ticker: str) -> ReportBundle | None:
    """Attempt Groq generation through OpenAI-compatible client."""
    load_dotenv()
    api_key = (os.getenv("GROQ_API_KEY") or "").strip()
    if not api_key:
        logger.warning("GROQ_API_KEY not set; skipping Groq fallback.")
        return None

    model = (os.getenv("GROQ_MODEL") or _DEFAULT_GROQ_MODEL).strip() or _DEFAULT_GROQ_MODEL
    max_completion_tokens = _DEFAULT_GROQ_MAX_COMPLETION_TOKENS
    raw_max_completion_tokens = (os.getenv("GROQ_MAX_COMPLETION_TOKENS") or "").strip()
    if raw_max_completion_tokens:
        try:
            parsed_tokens = int(raw_max_completion_tokens)
            if parsed_tokens > 0:
                max_completion_tokens = parsed_tokens
        except ValueError:
            logger.warning(
                "Invalid GROQ_MAX_COMPLETION_TOKENS=%r; using default %d.",
                raw_max_completion_tokens,
                _DEFAULT_GROQ_MAX_COMPLETION_TOKENS,
            )

    try:
        from openai import OpenAI
    except Exception as exc:
        logger.warning("OpenAI client import failed; skipping Groq fallback: %s", exc)
        return None

    try:
        client = OpenAI(
            api_key=api_key,
            base_url="https://api.groq.com/openai/v1",
        )
        parsed: dict[str, Any] | None = None
        last_raw_text = ""
        for attempt in range(1, 3):
            attempt_max_completion_tokens = (
                max_completion_tokens
                if attempt == 1
                else min(
                    int(max_completion_tokens * 1.5),
                    _MAX_GROQ_RETRY_COMPLETION_TOKENS,
                )
            )
            try:
                completion = client.chat.completions.create(
                    model=model,
                    messages=[
                        {
                            "role": "system",
                            "content": (
                                "You are a senior financial analyst. "
                                "Return only one valid JSON object."
                            ),
                        },
                        {
                            "role": "user",
                            "content": prompt if attempt == 1 else _build_json_retry_prompt(prompt),
                        },
                    ],
                    response_format={"type": "json_object"},
                    max_completion_tokens=attempt_max_completion_tokens,
                    temperature=0.2,
                )
            except Exception as exc:
                if _is_groq_json_length_error(exc):
                    logger.warning(
                        (
                            "Groq JSON generation hit token limit on attempt %d/2 "
                            "(max_completion_tokens=%d); retrying."
                        ),
                        attempt,
                        attempt_max_completion_tokens,
                    )
                    continue
                raise
            raw_text = (
                str(
                    (completion.choices[0].message.content if completion.choices else "")
                    or ""
                ).strip()
            )
            last_raw_text = raw_text
            parsed = _parse_json_object(raw_text)
            if parsed is not None:
                break
            logger.warning(
                "Groq response was not valid JSON on attempt %d/2.",
                attempt,
            )

        if parsed is None:
            if last_raw_text:
                logger.warning(
                    "Groq response parse failed after retry. Preview: %s",
                    last_raw_text[:400].replace("\n", "\\n"),
                )
            return None

        sections = _normalise_sections(parsed)
        full_report = str(parsed.get("fullReportMarkdown") or "").strip()
        if not full_report:
            full_report = _build_markdown_from_sections(ticker, sections)

        return {
            "source": "groq",
            "fullReport": full_report,
            "sections": sections,
        }
    except Exception as exc:
        logger.exception("Groq fallback generation failed: %s", exc)
        return None


def generate_report_bundle(
    ticker: str,
    fundamental_result: dict[str, Any] | None,
    technical_result: dict[str, Any] | None,
    sentiment_result: dict[str, Any] | None,
    overall_score: float,
    verdict: str,
    predicted_score: float | None = None,
) -> ReportBundle:
    """
    Generate sectioned LLM report. Returns:
    {
      "source": "gemini" | "groq" | "fallback",
      "fullReport": str,
      "sections": {
        "overall": str,
        "fundamental": str,
        "technical": str,
        "sentiment": str,
        "riskFactors": str,
        "conclusion": str,
        "disclaimer": str
      }
    }
    """
    provider = _resolve_report_llm_provider()
    prompt = _build_structured_prompt(
        ticker=ticker,
        fundamental_result=fundamental_result,
        technical_result=technical_result,
        sentiment_result=sentiment_result,
        overall_score=overall_score,
        verdict=verdict,
        predicted_score=predicted_score,
    )
    groq_prompt = _build_structured_prompt(
        ticker=ticker,
        fundamental_result=fundamental_result,
        technical_result=technical_result,
        sentiment_result=sentiment_result,
        overall_score=overall_score,
        verdict=verdict,
        predicted_score=predicted_score,
        include_full_report_markdown=False,
    )

    if provider == "groq":
        groq_bundle = _generate_report_bundle_with_groq(prompt=groq_prompt, ticker=ticker)
        if groq_bundle is not None:
            return groq_bundle
        return _placeholder_report_bundle(
            ticker=ticker,
            overall_score=overall_score,
            verdict=verdict,
        )

    client = _get_gemini_client()
    if client is None:
        if provider == "gemini":
            return _placeholder_report_bundle(
                ticker=ticker,
                overall_score=overall_score,
                verdict=verdict,
            )
        groq_bundle = _generate_report_bundle_with_groq(prompt=groq_prompt, ticker=ticker)
        if groq_bundle is not None:
            return groq_bundle
        return _placeholder_report_bundle(
            ticker=ticker,
            overall_score=overall_score,
            verdict=verdict,
        )

    try:
        parsed: dict[str, Any] | None = None
        last_raw_text = ""
        for attempt in range(1, 3):
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=(
                    prompt
                    if attempt == 1
                    else _build_json_retry_prompt(prompt)
                ),
                config=types.GenerateContentConfig(
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                    response_mime_type="application/json",
                ),
            )
            raw_text = (getattr(response, "text", "") or "").strip()
            last_raw_text = raw_text
            parsed = _parse_json_object(raw_text)
            if parsed is not None:
                break
            logger.warning(
                "Gemini response was not valid JSON on attempt %d/2.",
                attempt,
            )

        if parsed is None:
            if last_raw_text:
                logger.warning(
                    "Gemini response parse failed after retry. Preview: %s",
                    last_raw_text[:400].replace("\n", "\\n"),
                )
            logger.warning("Gemini response was not valid JSON. Falling back.")
            return _placeholder_report_bundle(
                ticker=ticker,
                overall_score=overall_score,
                verdict=verdict,
            )

        sections = _normalise_sections(parsed)
        full_report = str(parsed.get("fullReportMarkdown") or "").strip()
        if not full_report:
            full_report = _build_markdown_from_sections(ticker, sections)

        return {
            "source": "gemini",
            "fullReport": full_report,
            "sections": sections,
        }
    except Exception as exc:
        logger.warning("Gemini generation failed; using Groq fallback. Error: %s", exc)
        if provider == "gemini":
            return _placeholder_report_bundle(
                ticker=ticker,
                overall_score=overall_score,
                verdict=verdict,
            )
        groq_bundle = _generate_report_bundle_with_groq(prompt=groq_prompt, ticker=ticker)
        if groq_bundle is not None:
            return groq_bundle
        return _placeholder_report_bundle(
            ticker=ticker,
            overall_score=overall_score,
            verdict=verdict,
        )


def generate_report(
    ticker: str,
    fundamental_result: dict[str, Any] | None,
    technical_result: dict[str, Any] | None,
    sentiment_result: dict[str, Any] | None,
    overall_score: float,
    verdict: str,
    predicted_score: float | None = None,
) -> str:
    """Backward-compatible string report API."""
    bundle = generate_report_bundle(
        ticker=ticker,
        fundamental_result=fundamental_result,
        technical_result=technical_result,
        sentiment_result=sentiment_result,
        overall_score=overall_score,
        verdict=verdict,
        predicted_score=predicted_score,
    )
    return str(bundle.get("fullReport") or "")


def _extract_technical_prompt_data(
    technical_result: dict[str, Any] | None,
) -> dict[str, Any]:
    """
    Build a Gemini-ready technical payload from either:
    1) legacy shape with `data`, or
    2) current shape with top-level `indicators` / `structure`.
    """
    technical_payload = technical_result or {}
    technical_data = technical_payload.get("data") or {}
    indicators = technical_payload.get("indicators") or {}
    structure = technical_payload.get("structure") or {}

    return {
        "symbol": technical_data.get("symbol") or technical_payload.get("symbol"),
        "trend": technical_payload.get("trend"),
        "signal": technical_payload.get("signal"),
        "reasons": technical_payload.get("reasons") or [],
        "lastClose": technical_data.get("lastClose", indicators.get("close")),
        "sma20": technical_data.get("sma20", indicators.get("SMA20")),
        "sma50": technical_data.get("sma50", indicators.get("SMA50")),
        "sma200": indicators.get("SMA200"),
        "rsi": technical_data.get("rsi", indicators.get("RSI")),
        "macd": indicators.get("MACD"),
        "macdSignal": indicators.get("MACD_signal"),
        "adx": indicators.get("ADX"),
        "atr": indicators.get("ATR"),
        "fiftyTwoWeekLow": technical_data.get(
            "52WeekLow",
            indicators.get("52WeekLow"),
        ),
        "fiftyTwoWeekHigh": technical_data.get(
            "52WeekHigh",
            indicators.get("52WeekHigh"),
        ),
        "breakout": structure.get("breakout"),
        "volumeSpike": structure.get("volumeSpike"),
        "supportLevels": structure.get("support"),
        "resistanceLevels": structure.get("resistance"),
        "fibonacciLevels": structure.get("fibonacciLevels"),
    }


def _build_structured_prompt(
    ticker: str,
    fundamental_result: dict[str, Any] | None,
    technical_result: dict[str, Any] | None,
    sentiment_result: dict[str, Any] | None,
    overall_score: float,
    verdict: str,
    predicted_score: float | None = None,
    include_full_report_markdown: bool = True,
) -> str:
    fundamental_data = (fundamental_result or {}).get("data") or {}
    technical_data = _extract_technical_prompt_data(technical_result)
    sentiment_data = (sentiment_result or {}).get("data") or {}
    headlines = _compact_sentiment_headlines((sentiment_result or {}).get("headlines"))

    payload = _compact_prompt_payload({
        "ticker": ticker.upper(),
        "overallScore": overall_score,
        "predictedScore": predicted_score,
        "verdict": verdict,
        # "scoringSystem": {
        #     "overallWeights": {
        #         "fundamental": 0.35,
        #         "technical": 0.35,
        #         "sentiment": 0.30,
        #     },
        #     "technicalRules": {
        #         "priceVsSma20": "close>sma20 +5 else -3",
        #         "priceVsSma50": "close>sma50 +5 else -2",
        #         "rsi": "40-60 +3, <30 +4, >70 -4",
        #         "fiftyTwoWeekPosition": "30%-70% +2, >90% -2",
        #         "baseScore": 50,
        #     },
        #     "sentimentRules": {
        #         "model": "FinBERT",
        #         "labels": {"positive": 1, "neutral": 0, "negative": -1},
        #         "mapping": "weighted average in [-1,1], mapped to score = 50 + 50*avg",
        #     },
        #     "fundamentalRules": (
        #         "Sector-aware composite score from valuation, profitability, "
        #         "financial health, growth, and penalties."
        #     ),
        # },
        "fundamentalScore": (fundamental_result or {}).get("score"),
        "technicalScore": (technical_result or {}).get("score"),
        "sentimentScore": (sentiment_result or {}).get("score"),
        "fundamentalData": {
            "sector": fundamental_data.get("sector"),
            "industry": fundamental_data.get("industry"),
            "currentPrice": fundamental_data.get("currentPrice"),
            "trailingPE": fundamental_data.get("trailingPE"),
            "forwardPE": fundamental_data.get("forwardPE"),
            "pegRatio": fundamental_data.get("pegRatio"),
            "priceToBook": fundamental_data.get("priceToBook"),
            "returnOnEquity": fundamental_data.get("returnOnEquity"),
            "operatingMargins": fundamental_data.get("operatingMargins"),
            "profitMargins": fundamental_data.get("profitMargins"),
            "debtToEquity": fundamental_data.get("debtToEquity"),
            "revenueGrowth": fundamental_data.get("revenueGrowth"),
            "earningsGrowth": fundamental_data.get("earningsGrowth"),
            "dividendYield": fundamental_data.get("dividendYield"),
            "marketCap": fundamental_data.get("marketCap"),
            "fiftyTwoWeekLow": fundamental_data.get("52WeekLow"),
            "fiftyTwoWeekHigh": fundamental_data.get("52WeekHigh"),
            "sectorPeersAnalysis": fundamental_data.get("sectorPeersAnalysis"),
        },
        "technicalData": {
            "symbol": technical_data.get("symbol"),
            "trend": technical_data.get("trend"),
            "signal": technical_data.get("signal"),
            "reasons": technical_data.get("reasons"),
            "lastClose": technical_data.get("lastClose"),
            "sma20": technical_data.get("sma20"),
            "sma50": technical_data.get("sma50"),
            "sma200": technical_data.get("sma200"),
            "rsi": technical_data.get("rsi"),
            "macd": technical_data.get("macd"),
            "macdSignal": technical_data.get("macdSignal"),
            "adx": technical_data.get("adx"),
            "atr": technical_data.get("atr"),
            "fiftyTwoWeekLow": technical_data.get("fiftyTwoWeekLow"),
            "fiftyTwoWeekHigh": technical_data.get("fiftyTwoWeekHigh"),
            "breakout": technical_data.get("breakout"),
            "volumeSpike": technical_data.get("volumeSpike"),
            "supportLevels": technical_data.get("supportLevels"),
            "resistanceLevels": technical_data.get("resistanceLevels"),
            "fibonacciLevels": technical_data.get("fibonacciLevels"),
        },
        "sentimentData": {
            "headlineCount": sentiment_data.get("count"),
            "headlines": headlines,
        },
    })

    required_keys = (
        "overall, fundamental, technical, sentiment, riskFactors, conclusion, disclaimer, fullReportMarkdown"
        if include_full_report_markdown
        else "overall, fundamental, technical, sentiment, riskFactors, conclusion, disclaimer"
    )
    full_report_rule = (
        '- fullReportMarkdown: full markdown report with matching sections.\n'
        if include_full_report_markdown
        else ""
    )

    return (
        "Role: Senior Financial Analyst\n"
        "Task: Create an equity research report in the given output format based on the analysis results given in JSON input.\n"
        
        "The output should be produced in this output JSON format:\n"
        "JSON schema:\n"
        "{\n"
        '  "overall": "5-7 sentences: include component scores, and explain the result using the fundamental, technical and news sentiment metrics' \
        '",\n'
        '  "fundamental": "4-6 bullet points (use `- `). Make each bullet unique and specific. Mention the score and explain using the fundamental metrics. Include one bullet point comparing the company\'s valuation (trailing and forward P/E) to its sector peers based on the sectorPeersAnalysis data.",\n'
        '  "technical": "4-6 bullet points (use `- `). Make each bullet unique and specific: include technical score + bias in one bullet, trend context (price vs SMA20/SMA50/SMA200) in one bullet, momentum context (RSI/MACD/ADX) in one bullet, and key levels/structure (support, resistance, breakout, volume spike, fibonacci) plus one risk/watchout. Skip missing metrics instead of repeating available ones",\n'
        '  "sentiment": "Start with 3-5 bullet points (use `- `) highlighting the main insights from the news headlines, then add a `Summary:` paragraph of 4-6 sentences that mentions the score and explains the overall sentiment signal",\n'
        '  "riskFactors": "2-4 sentences",\n'
        '  "conclusion": "2-4 sentences: mention the final verdict and conclusion",\n'
        '  "disclaimer": "1 sentence",\n'
        '  "fullReportMarkdown": "full markdown report with matching sections"\n'
        "}\n\n"

        "Note:\n"
        "- Keep the tone professional.\n"
        "- Be concise and neutral.\n"
        "- Return strict JSON only (no markdown code fences).\n"
        "- For `technical`, keep the bullet points in a single string value.\n"
        "- For `technical`, avoid redundancy: do not repeat the same metric across bullets.\n"
        "- For `sentiment`, keep the bullets and summary in a single string value.\n"
        
        f"Input JSON:\n{json.dumps(payload, ensure_ascii=True, separators=(',', ':'))}"
    )


def _build_json_retry_prompt(base_prompt: str) -> str:
    return (
        f"{base_prompt}\n\n"
        "CRITICAL OUTPUT REQUIREMENT:\n"
        "Return only one valid JSON object.\n"
        "Do not include markdown, comments, or code fences.\n"
    )


def _compact_sentiment_headlines(raw_headlines: Any) -> list[dict[str, Any]]:
    """
    Keep prompt size bounded and stable while prioritizing relevance:
    - If positive_count + negative_count <= max: include all positive+negative,
      then fill with highest-confidence neutral headlines.
    - If positive_count + negative_count > max: sample positive/negative by
      their original ratio, ranked by highest confidence in each class; any
      rounding remainder is allocated to neutral headlines.
    """
    if not isinstance(raw_headlines, list):
        return []

    indexed_headlines: list[tuple[int, dict[str, Any]]] = []
    for idx, headline in enumerate(raw_headlines):
        if not isinstance(headline, dict):
            continue
        title = str(headline.get("title") or "").strip()
        if not title:
            continue
        if len(title) > _MAX_PROMPT_HEADLINE_CHARS:
            title = f"{title[:_MAX_PROMPT_HEADLINE_CHARS - 1].rstrip()}..."
        sentiment = str(headline.get("sentiment") or "neutral").strip().lower()
        if sentiment not in {"positive", "negative", "neutral"}:
            sentiment = "neutral"
        score = _safe_confidence_score(headline.get("sentimentScore"))
        indexed_headlines.append(
            (
                idx,
                {
                    "title": title,
                    "source": headline.get("source"),
                    "publishedAt": headline.get("publishedAt"),
                    "sentiment": sentiment,
                    "sentimentScore": score,
                },
            )
        )

    def _rank(group: list[tuple[int, dict[str, Any]]]) -> list[tuple[int, dict[str, Any]]]:
        # Higher confidence first; for ties prefer earlier input order.
        return sorted(
            group,
            key=lambda item: (-_safe_confidence_score(item[1].get("sentimentScore")), item[0]),
        )

    positives = _rank([item for item in indexed_headlines if item[1].get("sentiment") == "positive"])
    negatives = _rank([item for item in indexed_headlines if item[1].get("sentiment") == "negative"])
    neutrals = _rank([item for item in indexed_headlines if item[1].get("sentiment") == "neutral"])

    selected: list[dict[str, Any]] = []

    polar_count = len(positives) + len(negatives)
    if polar_count <= _MAX_PROMPT_HEADLINES:
        selected.extend([entry for _, entry in positives])
        selected.extend([entry for _, entry in negatives])
        remaining = _MAX_PROMPT_HEADLINES - len(selected)
        if remaining > 0:
            selected.extend([entry for _, entry in neutrals[:remaining]])
        return selected

    # Proportional split for positive/negative when they exceed max.
    positive_target = int((_MAX_PROMPT_HEADLINES * len(positives)) / polar_count)
    negative_target = int((_MAX_PROMPT_HEADLINES * len(negatives)) / polar_count)

    # Any integer-rounding leftover goes to neutrals as requested.
    neutral_target = _MAX_PROMPT_HEADLINES - (positive_target + negative_target)

    # Safety clamps to avoid impossible slices in edge cases.
    positive_target = min(positive_target, len(positives))
    negative_target = min(negative_target, len(negatives))

    selected.extend([entry for _, entry in positives[:positive_target]])
    selected.extend([entry for _, entry in negatives[:negative_target]])
    if neutral_target > 0:
        selected.extend([entry for _, entry in neutrals[:neutral_target]])

    # If any slot remains after clamps, fill from whichever class has leftover.
    remaining = _MAX_PROMPT_HEADLINES - len(selected)
    if remaining > 0:
        extra_negatives = negatives[negative_target:negative_target + remaining]
        selected.extend([entry for _, entry in extra_negatives])
        remaining = _MAX_PROMPT_HEADLINES - len(selected)
    if remaining > 0:
        extra_positives = positives[positive_target:positive_target + remaining]
        selected.extend([entry for _, entry in extra_positives])

    return selected


def _safe_confidence_score(value: Any) -> float:
    try:
        parsed = float(value)
        if parsed < 0:
            return 0.0
        return parsed
    except Exception:
        return 0.0


def _compact_prompt_payload(value: Any) -> Any:
    """
    Remove empty/null branches before serialization to keep prompt tokens bounded
    without changing the report schema requested from the model.
    """
    if isinstance(value, dict):
        compact_dict: dict[str, Any] = {}
        for key, item in value.items():
            compact_item = _compact_prompt_payload(item)
            if compact_item is None:
                continue
            if isinstance(compact_item, str) and not compact_item.strip():
                continue
            if isinstance(compact_item, (list, dict)) and not compact_item:
                continue
            compact_dict[key] = compact_item
        return compact_dict

    if isinstance(value, list):
        compact_list: list[Any] = []
        for item in value:
            compact_item = _compact_prompt_payload(item)
            if compact_item is None:
                continue
            if isinstance(compact_item, str) and not compact_item.strip():
                continue
            if isinstance(compact_item, (list, dict)) and not compact_item:
                continue
            compact_list.append(compact_item)
        return compact_list

    return value


def _truncate_floats(obj: Any, decimals: int = 4) -> Any:
    """Recursively truncate float values in dicts/lists to max decimal places."""
    if isinstance(obj, float):
        factor = 10 ** decimals
        return math.trunc(obj * factor) / factor
    elif isinstance(obj, dict):
        return {k: _truncate_floats(v, decimals) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_truncate_floats(item, decimals) for item in obj]
    return obj


def _is_groq_json_length_error(exc: Exception) -> bool:
    raw = str(exc).lower()
    return (
        "json_validate_failed" in raw
        or "max completion tokens reached" in raw
        or "failed to generate json" in raw
    )


def _parse_json_object(raw_text: str) -> dict[str, Any] | None:
    if not raw_text:
        return None

    # Fast path: entire response is JSON
    try:
        obj = json.loads(raw_text)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass

    # Fallback: parse fenced JSON blocks if present.
    for block in re.findall(r"```(?:json)?\s*([\s\S]*?)```", raw_text, flags=re.IGNORECASE):
        try:
            obj = json.loads(block.strip())
            if isinstance(obj, dict):
                return obj
        except Exception:
            continue

    # Robust scan: decode first valid JSON object anywhere in the text.
    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", raw_text):
        start = match.start()
        try:
            obj, _ = decoder.raw_decode(raw_text[start:])
            if isinstance(obj, dict):
                return obj
        except Exception:
            continue

    return None


def _normalise_sections(parsed: dict[str, Any]) -> ReportSections:
    def _text(key: str, default: str) -> str:
        value = parsed.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        return default

    return {
        "overall": _text("overall", "Overall section unavailable."),
        "fundamental": _text("fundamental", "Fundamental section unavailable."),
        "technical": _text("technical", "Technical section unavailable."),
        "sentiment": _text("sentiment", "Sentiment section unavailable."),
        "riskFactors": _text("riskFactors", "Risk section unavailable."),
        "conclusion": _text("conclusion", "Conclusion unavailable."),
        "disclaimer": _text(
            "disclaimer",
            "This is not investment advice. Do your own research.",
        ),
    }


def _build_markdown_from_sections(ticker: str, sections: ReportSections) -> str:
    return (
        f"# Stock Analysis Report: {ticker.upper()}\n\n"
        "## Overall\n"
        f"{sections['overall']}\n\n"
        "## Fundamental\n"
        f"{sections['fundamental']}\n\n"
        "## Technical\n"
        f"{sections['technical']}\n\n"
        "## Sentiment\n"
        f"{sections['sentiment']}\n\n"
        "## Risk Factors\n"
        f"{sections['riskFactors']}\n\n"
        "## Conclusion\n"
        f"{sections['conclusion']}\n\n"
        "## Disclaimer\n"
        f"{sections['disclaimer']}\n"
    )


def _placeholder_report_bundle(
    ticker: str,
    overall_score: float,
    verdict: str,
) -> ReportBundle:
    sections: ReportSections = {
        "overall": (
            f"Overall score is {overall_score}/100 with a {verdict} verdict "
            "based on the combined model signals."
        ),
        "fundamental": (
            "Fundamental interpretation is unavailable from Gemini at the moment. "
            "Fallback logic can still be used in the frontend."
        ),
        "technical": (
            "Technical interpretation is unavailable from Gemini at the moment. "
            "Fallback logic can still be used in the frontend."
        ),
        "sentiment": (
            "Sentiment interpretation is unavailable from Gemini at the moment. "
            "Fallback logic can still be used in the frontend."
        ),
        "riskFactors": "Macro conditions, earnings misses, and sector rotation remain key risks.",
        "conclusion": "Current output should be treated as informational, not a recommendation.",
        "disclaimer": "This is not investment advice. Do your own research.",
    }
    return {
        "source": "fallback",
        "fullReport": _build_markdown_from_sections(ticker, sections),
        "sections": sections,
    }


def generate_comparison_report(tickers: list[str], results: dict[str, Any]) -> str:
    """
    Generate an LLM comparison report comparing multiple stocks.
    Uses Gemini with Groq fallback.
    """
    provider = _resolve_report_llm_provider()
    
    compact_results = {}
    for t in tickers:
        r = results.get(t)
        if not r or "error" in r:
            continue
            
        ov = r.get("overview", {})
        fd = r.get("fundamental", {}).get("data", {})
        td = r.get("technical", {}).get("indicators", {})
        sd = r.get("sentiment", {})
        
        compact_results[t] = {
            "overallScore": ov.get("predictedScore") or ov.get("overallScore"),
            "verdict": ov.get("verdict"),
            "fundamentalScore": ov.get("fundamentalScore"),
            "technicalScore": ov.get("technicalScore"),
            "sentimentScore": ov.get("sentimentScore"),
            "fundamental": {
                "sector": fd.get("sector"),
                "trailingPE": fd.get("trailingPE"),
                "forwardPE": fd.get("forwardPE"),
                "revenueGrowth": fd.get("revenueGrowth"),
                "profitMargins": fd.get("profitMargins"),
                "debtToEquity": fd.get("debtToEquity"),
                "returnOnEquity": fd.get("returnOnEquity"),
            },
            "technical": {
                "rsi": td.get("RSI"),
                "trend": r.get("technical", {}).get("trend"),
                "signal": r.get("technical", {}).get("signal"),
            },
            "sentiment": {
                "headlineCount": sd.get("data", {}).get("count", 0),
            }
        }

    prompt = (
        "Role: Senior Financial Analyst\n"
        f"Task: Create a comparative equity research report for the following stocks: {', '.join(tickers)} based on the JSON input.\n"
        "The output must be ONLY a valid JSON object in this exact format:\n"
        "{\n"
        '  "report": "Your full markdown report string here"\n'
        "}\n\n"
        "Markdown Report Structure:\n"
        "1. Start immediately with an executive summary paragraph highlighting the clear winner based on overall scores and providing a 2-3 sentence rationale. DO NOT include an 'Executive Summary' heading.\n"
        "2. Fundamental Comparison: Write a paragraph of 3-4 sentences extracting insights about valuations, growth, and profitability (use a ## heading).\n"
        "3. Technical & Momentum: Write a paragraph of 3-4 sentences extracting insights about RSI, trends, and signals (use a ## heading).\n"
        "4. Sentiment Comparison: Write a paragraph of 3-4 sentences extracting insights about overall sentiment scores (use a ## heading).\n\n"
        "Note:\n"
        "- For sections 2, 3, and 4, you MUST write exactly one paragraph of 3-4 sentences. Do not use bullet points or lists.\n"
        "- Keep it concise, neutral, and professional.\n"
        "- Use standard markdown headings (##) only for sections 2, 3, and 4.\n"
        "- Do not use code fences around the JSON output.\n"
        f"Input JSON:\n{json.dumps(compact_results, separators=(',', ':'))}"
    )

    def _call_groq(p: str) -> str | None:
        load_dotenv()
        api_key = (os.getenv("GROQ_API_KEY") or "").strip()
        if not api_key: return None
        try:
            from openai import OpenAI
            client = OpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1")
            completion = client.chat.completions.create(
                model=(os.getenv("GROQ_MODEL") or _DEFAULT_GROQ_MODEL),
                messages=[
                    {"role": "system", "content": "Return only one valid JSON object."},
                    {"role": "user", "content": p},
                ],
                response_format={"type": "json_object"},
                max_completion_tokens=2000,
                temperature=0.2,
            )
            raw = str((completion.choices[0].message.content if completion.choices else "") or "").strip()
            parsed = _parse_json_object(raw)
            if parsed and "report" in parsed:
                rep = str(parsed["report"])
                rep = re.sub(r'(?i)^#+\s*Executive Summary\s*\n+', '', rep).strip()
                return rep
        except Exception:
            pass
        return None

    def _call_gemini(p: str) -> str | None:
        client = _get_gemini_client()
        if not client: return None
        try:
            from google.genai import types
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=p,
                config=types.GenerateContentConfig(
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                    response_mime_type="application/json",
                ),
            )
            raw = (getattr(response, "text", "") or "").strip()
            parsed = _parse_json_object(raw)
            if parsed and "report" in parsed:
                rep = str(parsed["report"])
                rep = re.sub(r'(?i)^#+\s*Executive Summary\s*\n+', '', rep).strip()
                return rep
        except Exception:
            pass
        return None

    fallback_report = f"Comparative analysis is currently unavailable for {', '.join(tickers)}."

    if provider == "groq":
        return _call_groq(prompt) or fallback_report
    
    # Default auto / gemini
    gem_res = _call_gemini(prompt)
    if gem_res: return gem_res
    
    if provider == "auto":
        groq_res = _call_groq(_build_json_retry_prompt(prompt))
        if groq_res: return groq_res
        
    return fallback_report

