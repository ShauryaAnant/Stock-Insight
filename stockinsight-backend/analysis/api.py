"""
Analysis API: single entry point for the frontend. GET /api/analysis/{ticker}/
"""
import logging
from typing import Any

from django.http import HttpResponse, JsonResponse
from ninja import Router, Schema

from analysis.search import search_companies
from analysis.services import run_full_analysis, run_parallel_comparison
from reports.pdf_services import render_analysis_pdf
from technical.services import get_chart_data
from reports.services import generate_report_bundle

router = Router(tags=["analysis"])
logger = logging.getLogger(__name__)


class CompareRequest(Schema):
    tickers: list[str]


class CompareReportRequest(Schema):
    tickers: list[str]
    results: dict[str, Any]


class ReportRequest(Schema):
    ticker: str
    fundamental_result: dict[str, Any] | None = None
    technical_result: dict[str, Any] | None = None
    sentiment_result: dict[str, Any] | None = None
    overall_score: float
    verdict: str


class PdfRequest(Schema):
    ticker: str
    overview: dict[str, Any]
    fundamental: dict[str, Any] | None = None
    technical: dict[str, Any] | None = None
    sentiment: dict[str, Any] | None = None
    report: str | None = ""
    reportSections: dict[str, Any] | None = None
    reportSource: str | None = None


def _render_pdf_response(analysis_payload: dict[str, Any], filename_ticker: str) -> HttpResponse | JsonResponse:
    try:
        pdf_bytes = render_analysis_pdf(analysis_payload)
    except RuntimeError as exc:
        return JsonResponse({"error": str(exc)}, status=503)
    except Exception:
        logger.exception("PDF generation failed for payload ticker=%s", filename_ticker)
        return JsonResponse({"error": "Failed to generate PDF report."}, status=500)

    response = HttpResponse(pdf_bytes, content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="{filename_ticker}_StockInsight_Report.pdf"'
    response["Cache-Control"] = "no-store"
    return response


def _payload_to_analysis_payload(payload: PdfRequest) -> dict[str, Any]:
    ticker = payload.ticker.strip().upper()
    return {
        "ticker": ticker,
        "overview": payload.overview,
        "fundamental": payload.fundamental,
        "technical": payload.technical,
        "sentiment": payload.sentiment,
        "report": payload.report or "",
        "reportSections": payload.reportSections or {},
        "reportSource": payload.reportSource or "unknown",
    }


@router.post("/analysis/report")
def generate_report_endpoint(request, payload: ReportRequest):
    """
    Stateless endpoint to generate the LLM report using provided analysis data.
    """
    return generate_report_bundle(
        ticker=payload.ticker,
        fundamental_result=payload.fundamental_result,
        technical_result=payload.technical_result,
        sentiment_result=payload.sentiment_result,
        overall_score=payload.overall_score,
        verdict=payload.verdict
    )


@router.post("/analysis/compare")
def compare_stocks(request, payload: CompareRequest):
    """
    Run full analysis for multiple tickers concurrently.
    Reports are skipped for speed; use the single-ticker endpoint for full reports.
    """
    tickers = payload.tickers[:10]  # cap at 10
    if not tickers:
        return {"results": {}}
    return run_parallel_comparison(tickers)


@router.post("/analysis/compare-report")
def generate_compare_report(request, payload: CompareReportRequest):
    """
    Generate an LLM comparison summary for multiple tickers.
    """
    from reports.services import generate_comparison_report
    report_md = generate_comparison_report(
        tickers=payload.tickers,
        results=payload.results
    )
    return {"report": report_md}


@router.post("/analysis/generate-pdf")
def download_analysis_pdf_from_payload_v2(request, payload: PdfRequest):
    """
    Preferred payload endpoint for PDF generation.
    """
    ticker = payload.ticker.strip().upper()
    if not ticker:
        return JsonResponse({"error": "Ticker is required."}, status=400)
    return _render_pdf_response(_payload_to_analysis_payload(payload), ticker)


@router.post("/analysis/pdf")
def download_analysis_pdf_from_payload(request, payload: PdfRequest):
    """
    Generate a PDF report directly from the provided analysis payload.
    This avoids re-running full analysis during download.
    """
    ticker = payload.ticker.strip().upper()
    if not ticker:
        return JsonResponse({"error": "Ticker is required."}, status=400)
    return _render_pdf_response(_payload_to_analysis_payload(payload), ticker)


@router.get("/analysis/{ticker}")
def get_analysis(
    request,
    ticker: str,
    include_report: bool = True,
):
    """
    Run full analysis for the given ticker and return overview, fundamental,
    technical, sentiment, and optional comprehensive report.
    """
    result = run_full_analysis(
        ticker=ticker,
        include_report=include_report,
    )
    if result is None:
        return JsonResponse({"error": "Ticker not found or invalid"}, status=404)
    return result


@router.get("/analysis/{ticker}/pdf")
def download_analysis_pdf(
    request,
    ticker: str,
    include_report: bool = False,
):
    """
    Generate a 4-page PDF report for a ticker and return as attachment.
    """
    result = run_full_analysis(
        ticker=ticker,
        include_report=include_report,
    )
    if result is None:
        return JsonResponse({"error": "Ticker not found or invalid"}, status=404)

    try:
        pdf_bytes = render_analysis_pdf(result)
    except RuntimeError as exc:
        return JsonResponse({"error": str(exc)}, status=503)
    except Exception:
        logger.exception("PDF generation failed for ticker=%s", ticker)
        return JsonResponse({"error": "Failed to generate PDF report."}, status=500)

    filename = f"{ticker.upper()}_StockInsight_Report.pdf"
    response = HttpResponse(pdf_bytes, content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response["Cache-Control"] = "no-store"
    return response


@router.get("/analysis/chart/{ticker}")
def fetch_chart(
    request,
    ticker: str,
    duration: str = "1Y",
):
    """
    Fetch specific fine-grained chart data based on duration.
    """
    return get_chart_data(ticker=ticker, duration=duration)


@router.get("/search")
def search_symbols(
    request,
    q: str = "",
    limit: int = 8,
):
    """
    Return company/ticker suggestions for the search bar.
    """
    return {
        "query": q.strip(),
        "suggestions": search_companies(q, limit=limit),
    }

