# StockInsight 📈

> **Multi-Factor Stock Analysis Engine**

StockInsight is a full-stack financial evaluation platform that aggregates quantitative data, runs financial NLP sentiment analysis, leverages machine learning forecasts, and hosts interactive community discussion hubs for stock tickers to produce a comprehensive analysis and exportable reports. It also lets users compare stocks side-by-side.

Check it out at: https://stock-insight.dev/

---

## 🌟 Features & App Modules

The backend is composed of several independent Django apps:

### 1. Analysis Orchestrator (`analysis`)
- Endpoint: `GET /api/analysis/{ticker}` fetches data from the fundamental, technical, and sentiment modules in parallel.
- Endpoint: `POST /api/analysis/compare` evaluates multiple stocks side-by-side.
- Endpoint: `GET /api/search` offers auto-complete ticker suggestions.

### 2. Fundamental Analysis (`fundamental`)
- Scrapes financial statements (income, balance sheet, cash flows) from yfinance.
- Calculates a **0–100 Fundamental Score**:
  - **Valuation (30%)**: Valuation relative to sector peers using `tanh` mapping, PEG ratio, and Price-to-Book.
  - **Profitability (30%)**: Scores Operating and Profit Margins, and ROE against static benchmarks.
  - **Financial Health (25%)**: Evaluates Debt-to-Equity and Current Ratio (ROA for financial companies).
  - **Growth & Dividends (15%)**: Measures revenue/EPS growth and payout ratios.
  - **Penalties**: Deducts points for high debt coupled with low liquidity.

### 3. Technical Indicators (`technical`)
- Calculates a **0–100 Technical Score** that shifts indicator weights based on market state (Trending vs Sideways):
  - Long-Term Trend (divergence between 50-day and 200-day SMA)
  - Short-Term Position (drift against 20-day SMA)
  - RSI (14-period normalized via `tanh`)
  - MACD (distance between MACD and Signal lines)
  - Volume (relative volume on breakouts)
  - Volatility penalty (based on ATR ratio)

### 4. News Sentiment (`sentiment`)
- Gathers news articles from Finnhub, NewsAPI, and NewsData.io.
- Deduplicates articles using Levenshtein distance string matching.
- Runs headlines through the `ProsusAI/finbert` model.
- Maps positive/negative label confidence scores into a **0-100 Sentiment Score**.

### 5. Aggregate Analysis & Verdict (`analysis`)
- **Overall Score (0-100)**: Computes an overall score using XGBoostML model using individual scores: **Fundamental**, **Technical**, and **Sentiment**, and other relevant metrics.
- **Investment Verdict**: Maps the overall score directly into a final Buy/Sell/Hold recommendation based on the industry benchmarks.

### 6. Report Generation (`reports`)
- Aggregates technical, fundamental, and sentiment metrics into a text report.
- Features a fallback chain: Google Gemini Pro $\rightarrow$ Groq (gpt-oss) $\rightarrow$ local template.
- Supports PDF exports of the compiled data.

### 7. Forums & Discussions (`discussions`)
- Ticker-specific message boards located at `/api/discussions/{ticker}`.
- Allows authenticated users to write posts, reply in nested threads, and vote.
- Uses Django QuerySet annotations (Subqueries, Coalesce) to fetch reply trees and vote counts in a single query.

---

## 🛠️ Architecture & Tech Stack

### Frontend
- **Framework:** React 19, TypeScript, Vite
- **Data Visualization:** Recharts for charting
- **Exports:** jsPDF and html2canvas for PDF report generation
- **Styling:** Custom CSS layout

### Backend
- **Core Framework:** Django 6.0.x
- **API Engine:** Django Ninja (OpenAPI support via Pydantic)
- **Database:** PostgreSQL (with SQLite fallback for local development)
- **Python Libraries:** Pandas, NumPy, Scikit-learn, SciPy, HuggingFace Hub, Joblib

### AI & NLP Services
- **Analysis Reports:** Google Gemini Pro (`google-genai`) with Groq API (`openai/gpt-oss-120b`) fallback
- **News Sentiment Analysis:** HuggingFace news classification model (`ProsusAI/finbert`) running on PyTorch

---



## 📂 Repository Structure

```text
stockinsight/
├── stockinsight-backend/         # Django backend app
│   ├── analysis/                 # Orchestration & ticker comparisons
│   ├── fundamental/              # Statement scraping & scoring models
│   ├── technical/                # Charting API & technical scoring
│   ├── sentiment/                # Article scraping & FinBERT sentiment
│   ├── reports/                  # Generative reports & fallback system
│   ├── discussions/              # Message boards & reply trees
│   ├── backend/                  # Global settings, routing, and Auth API
│   └── ml_training/              # Machine learning experiments
├── frontend/                     # React + Vite + TypeScript frontend
│   ├── src/components/           # Search, discussion, auth, and PDF components
│   └── api.ts                    # Axios wrapper for backend endpoints
└── requirements.txt              # Primary Python package requirements
```

---

## 🚀 Quick Start

### Prerequisites
- **Python:** `3.11` or higher
- **Node.js:** `18` or higher
- **Database:** PostgreSQL (falls back to SQLite if local database variables are not set)

To run it locally, follow these steps:

### 1. Backend Setup

```bash
# Clone the repository and navigate in
cd stockinsight

# Create & activate virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure Environment
cp env_example.txt .env  # Add your API Keys (Gemini, Finnhub, etc.) inside .env

# Migrate database & run server
python stockinsight-backend/manage.py migrate
python stockinsight-backend/manage.py runserver
```
> Interactive OpenAPI documentation will be live at `http://127.0.0.1:8000/api/docs`.

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```
> The web application will launch at `http://localhost:5173/`.

