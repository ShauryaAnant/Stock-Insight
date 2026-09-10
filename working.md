# StockInsight: Advanced Stock Analysis Platform

This document describes the overall architecture, components, and workflows of the StockInsight platform. StockInsight is a full-stack platform consisting of a **React + TypeScript + Vite** frontend and a **Django + Django Ninja** backend, designed to offer comprehensive analytical capabilities, community discussions, and report generation for stock market tickers.

---

## Architecture Overview

1.  **Frontend**: A modern Single Page Application (SPA) built using React, TypeScript, and Vite.
2.  **Backend**: A Django application that exposes high-performance REST APIs via `django-ninja` (an OpenAPI-based fast framework for Django).
3.  **Database**: Configured to use a PostgreSQL database by default, falling back to SQLite for local basic use when credentials are not supplied.

---

## Backend Components (Django Apps)

The backend is strictly divided into distinct domain-driven Django apps, each taking responsibility for a specific piece of business logic.

### 1. `analysis`
**Purpose**: Acts as the main orchestration and gateway layer for stock evaluations.
**Working**: 
- Provides endpoints like `GET /api/analysis/{ticker}` to run a full analysis pipeline on a stock.
- Coordinates data retrieval from the `fundamental`, `technical`, and `sentiment` apps, subsequently passing that data to the `reports` app to generate a human-readable AI analysis.
- Supports concurrent/parallel comparisons (`POST /api/analysis/compare`) of multiple stocks.
- Exposes a `/search` endpoint to fetch company ticker suggestions using a fuzzy search.
- Utilizes a specialized **ML Service** to provide a probability-based "Upside Potential" score using a trained XGBoost model.

### 2. `fundamental`
**Purpose**: Fetches and processes core fundamental data about a company.
**Working**: 
- Connects to external APIs (like Yahoo Finance, Alpha Vantage, or specialized financial data providers) to fetch income statements, balance sheets, cash flows, and key metrics (P/E ratio, market cap, EPS, etc.).

### 3. `technical`
**Purpose**: Generates and manages technical indicators and charting data.
**Working**: 
- Collects historical price volume data to compute signals such as Moving Averages, RSI, MACD.
- Exposes internal services and an API (`/analysis/chart/{ticker}`) that the frontend consumes to render dynamic, fine-grained charts.

### 4. `sentiment`
**Purpose**: Gauges market and social sentiment for a given stock.
**Working**:
- Scrapes or integrates with news APIs to fetch recent headlines.
- Uses Natural Language Processing (either internal models or external LLM API calls) to evaluate whether the recent news surrounding a stock is overwhelmingly positive, negative, or neutral.

### 5. `reports`
**Purpose**: Generates natural language summaries and comprehensive qualitative analysis.
**Working**: 
- Provides a `generate_report_bundle` service.
- It receives aggregated metrics from the fundamental, technical, and sentiment analyses.
- Synthesizes all disparate data points into a finalized, contextual narrative—serving as an executive summary for the user and determining an "Overall Score".
- Supports both single-stock analysis and multi-ticker comparison reports.
- Uses an LLM fallback chain for reliability: Gemini is primary, Groq (gpt-oss) is used as fallback.
- Employs robust regex-based parsing to transform LLM outputs into structured bullet points and clean paragraphs, ensuring visual consistency across the dashboard and PDF exports.

### 6. `discussions`
**Purpose**: Manages the community forum and social layer of the application.
**Working**: 
- Provides a suite of fully functional API endpoints (`/api/discussions/...`) built around `DiscussionPost`, `DiscussionReply`, and `Vote` models.
- Allows authenticated users to create posts for specific stock tickers, reply in threaded format, and cast upvotes/downvotes.
- Heavily uses advanced Django QuerySet annotations (Subqueries, Coalesce) to fetch deeply nested vote counts and reply trees via optimized single/double database queries.

### 7. `backend` (Core App)
**Purpose**: Manages project-wide settings and centralized routing.
**Working**: 
- `settings.py` sets up CORS, Database configurations, Logger formats, Middleware, and API keys mappings.
- `urls.py` registers the nested `Router` objects from `analysis`, `discussions`, and authentication into a single `NinjaAPI` root endpoint (`/api/`).
- `auth_api.py` exposes REST APIs for secure user authentication (login, logout, session management, or token provisioning).

---

## Frontend Components (React + Vite)

The frontend is built to be interactive and heavily typesafe. The structure is separated into overarching views directly linked to the API, alongside specialized UI components.

### 1. `App.tsx` & `main.tsx`
**Purpose**: The root entry points.
**Working**: 
- Defines the layout, handles application-wide state (like selected tickers or global authentication contexts), and includes the core CSS styles (`App.css`, `index.css`).
- Contains the main grid mapping for where charts, reports, and sentiment widgets reside.
- Houses primary page components such as the main Dashboard and the `ComparePage`.

### 2. `api.ts`
**Purpose**: Centralized Axios/Fetch layer.
**Working**: 
- Wraps all communication with the backend. Exposes strongly-typed asynchronous functions (e.g., `fetchAnalysis`, `login`, `submitVote`) corresponding to the backend's API schema. 
- Gracefully handles CORS headers and attaching session tokens.

### 3. Components (`src/components/`)
* **`StockSearchForm.tsx`**
  **Working**: Form providing an interactive autocomplete drop-down. As users type, it calls the `GET /api/search` endpoint to suggest valid tickers.
* **`AuthPanel.tsx`**
  **Working**: A secure panel encompassing Login/Signup forms. It manages the token exchange with the Django backend and persists the user session in local memory/storage.
* **`DiscussionSection.tsx`**
  **Working**: The user interface for the discussion board. Renders a specific ticker's forum topics fetching from `/api/discussions/{ticker}`. It includes UI logic for recursive rendering of nested replies and optimistic UI updates when upvoting/downvoting a post.
* **`PdfReportTemplate.tsx`** & **`PdfReportTemplate.css`**
  **Working**: Formats the comprehensive JSON analysis (fundamental, technical, sentiment + final verdict) into a clean, printable/exportable layout.
  **Recent Improvements**: Enhanced with precise visual alignment for financial tables (Cashflow, Balance Sheet) and improved handling of multi-line textual content to prevent truncation.

### 4. `ComparePage` (Component)
**Purpose**: Provides side-by-side comparison of multiple stocks.
**Working**:
- Orchestrates parallel analysis calls for selected tickers.
- Persists report data in `sessionStorage` to maintain state across navigation.
- Features timestamped hints to indicate data freshness and specialized prompts for comparative AI analysis.

---

## Scoring Logic

StockInsight compiles a rigorous metric-based score for fundamental, technical, and sentiment profiles. Each translates into a 0-100 scale using distinct methodologies.

### 1. Fundamental Scoring
The fundamental algorithm accumulates points out of 100, partitioned into 4 primary pillars along with severe penalizations for high risk.

*   **Valuation (Max 30%)**: Evaluates P/E ratios iteratively. It employs a dynamic calculation determining the stock's _relative standing_ against its sector peers using a hyperbolic tangent (tanh) function to assign points conditionally (Undervalued, Fairly Valued). Points are also granted for strong PEG (<1.0) and optimal Price-to-Book ratio.
*   **Profitability & Efficiency (Max 30%)**: Scores strictly depend on Return on Equity (ROE), operating margins, and profit margins crossing specific progressive thresholds (e.g., >8%, >15%).
*   **Financial Health & Liquidity (Max 25%)**: Contextually adjusts based on the industry sector. For banks/financials, it emphasizes ROA; for others, it scores tightly against the Debt-to-Equity (ideal < 50), Current Ratio (> 1.5), and Free Cash Flow.
*   **Growth & Dividends (Max 15%)**: Awards points for double-digit historical revenue and EPS growth percentages. Dividends factor affirmatively but penalize heavily if the yield is supported by a dangerously high payout ratio (> 85%).
*   **Penalties**: Deductions (up to -20 points individually) are forcefully pushed for toxic combinations like exceptionally high debt matched with severe illiquidity (D/E > 300 & CR < 0.8), drastic negative net margins, or companies that show overvaluation combined with declining YoY revenue.

### 2. Technical Scoring
Technical analysis centers around a highly smoothed, regime-aware continuous scoring engine initialized at a baseline parameter of **50 points**, bounding at (0-100). The engine auto-detects the current market structure (Trending, Sideways, Volatile) to dynamically morph internal weightings.

*   **Long-Term Trend (±20 pts)**: Normalized divergence between the 50-day and 200-day Simple Moving Averages.
*   **Short-Term Position (±10 pts)**: Short span closing price drift against the 20-day SMA.
*   **RSI Strength (±12 pts)**: Employs a regime-aware evaluation of the 14-period RSI curve using a `tanh` normalization factor, allowing the indicator's saturation threshold to be "widened" or "shrunk" based on existing volatility.
*   **MACD & Momentum (±12 pts)**: Calculates the raw numeric distance bridging the MACD and the Signal line.
*   **Volume & Breakouts**: Confirmed breakouts crossing a 20-period highest-high net add up to 8 points on surging volume. The algorithm uses proportional ratio scaling (latest_vol vs 20-period-average_vol) instead of binary boolean toggles.
*   **Risk Abatement**: A persistent volatility penalty removes points proportional to the `ATR / Close` ratio to defensively guard conservative investors against sporadic whipsaw chart actions.

### 3. Sentiment Scoring
Evaluates qualitative news utilizing cutting-edge Financial NLP text classifications.

*   **Data Aggregation & Deduplication**: Fetches a deep timeframe list of headlines from Finnhub, alternatively pulling from NewsApi, NewsData.io, or NewsApi.ai if upstream failures occur. Headlines are structurally normalized and strictly deduped utilizing Levenshtein-based string matching (`SequenceMatcher`).
*   **FinBERT AI Inferencing**: The deduped headline datasets pass sequentially through the `ProsusAI/finbert` HuggingFace pipeline in memory.
*   **Calculations**: The NLP model yields `positive/neutral/negative` text labels bounding a predictive confidence score representing accuracy.
*   **Final Score Engine**: StockInsight filters out strictly `neutral` data. The confidence levels of purely sentiment-bearing labels map directly into values of `-1` (Negative) and `1` (Positive). A weighted summation provides a mean metric strictly across `-1 to 1`. This maps into a straightforward percentage (`50 + 50 * Average`) determining the overarching sentiment score natively constrained between 0 and 100.

### 4. ML-Based Predictive Scoring
Beyond metric-based scoring, StockInsight employs a sophisticated machine learning layer to estimate future performance.
*   **Algorithm**: Utilizes an **XGBoost Classifier** (with an automated Random Forest fallback) wrapped in a scikit-learn pipeline.
*   **Predictive Goal**: Specifically trained to predict the probability that a stock's price will increase over a **30-day horizon**.
*   **Feature Engineering**: The model ingests processed scores (Fundamental, Technical, Sentiment) alongside exogenous market indicators including the **VIX Index**, stock **Beta**, **PEG Ratio**, and 14-day **RSI**. It also accounts for industry-specific biases through one-hot encoded **Sector** data.
*   **Output**: Returns a 0.0-100.0 probability score representing the "Upside Potential." This value is used to refine the final "Overall Score" presented to the user.

---

## End-to-End Workflow

1. **User Discovery**: A user accesses the site, types "AAPL" into the `StockSearchForm.tsx`.
2. **Analysis Orchestration**: The frontend calls `GET /api/analysis/AAPL`. 
   - **Cancellation**: Users can abort an ongoing analysis at any time. The frontend sends a signal to the backend to terminate the task, and the UI resets gracefully.
3. **Data Aggregation**: The backend `analysis` app orchestrates concurrent tasks.
 It asks `fundamental` for balance sheets, `technical` for moving averages, and `sentiment` for current news sentiment.
4. **Report Synthesis**: Once data is collated, the `reports` app is called upon to bundle these into a qualitative report.
5. **Presentation**: Data returns to the frontend, displaying dynamic charting and the textual report. The user can export this info using the `PdfReportTemplate.tsx`.
6. **Community Interaction**: The user logs in via `AuthPanel.tsx` and scrolls to the `DiscussionSection.tsx`, reading top opinions on "AAPL" and participating in threads routed to the backend's `discussions` module.

---

## Features Under Development

- Integration of real-time streaming data for live price updates.
- Expansion of the ML model to support multi-class classification (e.g., Strong Buy, Buy, Hold, Sell).

---

## Deployment & Infrastructure

The StockInsight platform is designed for scalable deployment using modern cloud infrastructure.

### 1. Frontend (Vercel)
*   **Platform**: Deployed as a static SPA on **Vercel**.
*   **Routing**: Configured via `vercel.json` to handle client-side routing by rewriting all requests to `index.html`.
*   **API Connection**: Communicates with the backend via a centralized `api.ts` layer, with the base URL typically managed via environment variables.

### 2. Backend (Django)
*   **Framework**: High-performance REST APIs powered by **Django Ninja**.
*   **Database**: Primarily uses **PostgreSQL** in production (configured via `DB_HOST`, `DB_NAME`, etc.).
*   **System Dependencies**: Requires **GTK**, **Pango**, and **Cairo** libraries on the host system to support the **WeasyPrint** PDF engine.
*   **ML Artifacts**: Trained models (XGBoost/Random Forest) are loaded from the `ml_artifacts/` directory at runtime.

### 3. CI/CD & Environments
*   **Local Development**: Supports **SQLite** fallback for rapid prototyping without a full PostgreSQL setup.
*   **Security**: Environment variables are managed via `.env` files (loaded automatically by `settings.py`).
*   **Version Control**: Automated deployment pipelines are typically triggered on merges to the `main` branch.
