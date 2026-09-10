# Frontend Design Document - StockInsight

## 1. Overview
The frontend of the StockInsight application is built as a React Single Page Application (SPA) natively utilizing TypeScript. The majority of the application's view logic, layout, and component definitions are centralized within a monolithic main file (`App.tsx`), with some reusable components compartmentalized into the `src/components/` directory.

## 2. Directory & Core File Structure
* **`src/main.tsx`**: Application entry point.
* **`src/App.tsx`**: The core application shell. It contains the majority of the UI codebase (over 6000 lines), defining the layout, routing, and numerous inline components.
* **`src/api.ts`**: Encapsulates all backend data fetching functions (e.g., `fetchAnalysis`, `fetchComparisonAnalysis`, `loginUser`, `fetchCurrentUser`), decoupling data handling from presentation logic.
* **`src/types.ts`**: A centralized repository for TypeScript interfaces representing domain entities, props, and API responses (e.g., `AnalysisResponse`, `AuthMode`, `FundamentalData`).
* **`src/components/`**: Externalized React components. Includes:
  * `AuthPanel.tsx` - Login/Signup presentation logic.
  * `DiscussionSection.tsx` - Component for community discussions.
  * `StockSearchForm.tsx` - Search input form handling.
* **`src/App.css` / `src/index.css`**: Global design and Vanilla CSS styles.

## 3. Routing Mechanism
Instead of employing standard third-party libraries like `react-router-dom`, StockInsight implements a **custom, lightweight routing architecture** utilizing the standard HTML5 History API.

### 3.1. `usePathRouter` Hook
A custom hook that returns the current `pathname`, `search`, and a `navigate` function. It manages state via `window.location` and listens to `popstate` events to facilitate Single-Page Application (SPA) transitions without full page reloads.

### 3.2. `parseRoute` Function
Translates the string URL paths into a strictly typed `AppRoute` union literal (e.g. `{ type: 'home' }`, `{ type: 'stock', ticker: 'AAPL', tab: 'overview' }`). The router uses regex matching to map endpoints effectively:
* `.` / `/` -> `HomePage`
* `/login`, `/signup` -> `AuthPage`
* `/compare` -> `ComparePage`
* `/stock/:ticker` -> `AnalysisPage` (defaults to 'overview' tab)
* `/stock/:ticker/:tab` -> `AnalysisPage` displaying detailed tabs: `overview`, `fundamental`, `technical`, `sentiment`, `full-report`, `discussion`.

## 4. Component Hierarchy
The main application resides primarily inside `App.tsx`, organized hierarchically as follows:

### 4.1. Core Application Shell Components
* **`<App />`**: Acts as the main router switch and state manager for Authentication (`authStatus`, `authUser`) and Theming (`theme`). Renders the main skeleton components:
  * **`<HeaderBar />`**: The sticky navigation bar featuring the branding, search bar, comparison link, dark mode toggle, and authentication status.

### 4.2. Page Components
The route dictates which of these top-level page components should render:
* **`<HomePage />`**: The landing hero component, offering search and comparison entry points.
* **`<AuthPage />`**: Wraps the `<AuthPanel>` managing user sign-in and registration flow.
* **`<ComparePage />`**: Displays a robust comparative analysis matrix for multiple stock tickers, handling its own local caching (`sessionStorage`).
* **`<AnalysisPage />`**: Handles sub-routing navigation switching between tabs (Overview, Fundamental, Technical, Sentiment, etc.) for a specific ticker.

### 4.3. Analysis Sections
Depending on the active tab of an `AnalysisPage`, it mounts detailed UI sections:
* **`<OverviewSection />`**: Summary displaying key fundamental, technical, and LLM-generated insights.
* **`<FundamentalSection />`**: Displays detailed enterprise valuation metrics, P/E charting, and income statements.
* **`<TechnicalSection />`**: Renders robust candlestick/price history charts (Recharts) alongside indicators, featuring `<ChartTypeSelect />` options for various granularities (1D, 1M, YTD, etc).
* **`<SentimentSection />`**: Presents analysis of news events relating to the stock, alongside polarity/sentiment scoring UI.
* **`<FullReportSection />`**: Compiles aspects above into a unified reading layout, including the `<FullReportScoreMeter />`.

### 4.4. Micro-Components / Utilities
Numerous inline helper components render the granular UI pieces:
* **`<CompareRow />`**
* **`<SnapshotMetricTile />`**
* **`<IndicatorMiniSparkline />`** / **`<IndicatorMiniPoint />`**
* **`<MetricList />`**
* **`<LoadingPanel />`** and **`<UnavailablePanel />`**
* **`<ColoredValue />`**

## 5. State Management & Data Flow
* **Props Drilling & Hooks**: The application favors built-in React contexts and standard lifting-state-up methodology (`useState`, `useRef`, `useCallback`, `useMemo`) over global stores like Redux.
* **Persistence**:
  * `localStorage` is used for theming choices saving user UI preference.
  * `sessionStorage` is utilized primarily in the `<ComparePage />` to cache user queries and stock data between rapid transitions.
* **Forms & Search**: The `StockSearchForm` is abstracted and heavily reused to manage URL injection of queried stock symbols.

## 6. Known Potential Technical Debt
The architecture within `App.tsx` is vast, holding over 6,000 lines encompassing nearly all section components and utility views. For better maintainability and code splitting, the application could significantly benefit from modularizing its sections (e.g. `<AnalysisPage />`, `<OverviewSection />`, `<ComparePage />`) into discrete files under the `src/pages` and `src/components` architecture in future iterations.
