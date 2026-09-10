import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend,
  AreaChart, Area,
  PieChart, Pie, Cell,
  LineChart, Line
} from 'recharts'
import './App.css'
import { AuthPanel } from './components/AuthPanel'
import { StockSearchForm } from './components/StockSearchForm'
import { changeUserPassword, completeGoogleSignup, downloadAnalysisPdf, fetchAnalysis, fetchComparisonAnalysis, fetchComparisonReport, fetchCurrentUser, loginUser, loginWithGoogle, logoutUser, registerUser } from './api'
import type { GoogleAuthResult } from './api'
import { DiscussionSection } from './components/DiscussionSection'
import type {
  AnalysisResponse,
  AuthMode,
  AuthUser,
  ComparisonResponse,
  FundamentalData,
  OhlcvPoint,
  ReportSections,
  SentimentHeadline,
  SentimentResult,
  TechnicalData,
  TechnicalResult,
} from './types'

type AnalysisTab =
  | 'overview'
  | 'fundamental'
  | 'technical'
  | 'sentiment'
  | 'full-report'
  | 'discussion'

const ANALYSIS_TABS: Array<{ key: AnalysisTab; label: string }> = [
  { key: 'overview', label: 'Overall' },
  { key: 'fundamental', label: 'Fundamental' },
  { key: 'technical', label: 'Technical' },
  { key: 'sentiment', label: 'Sentiment' },
  { key: 'full-report', label: 'Full Report' },
  { key: 'discussion', label: 'Discussion' },
]

type AppRoute =
  | { type: 'home' }
  | { type: 'auth'; mode: AuthMode }
  | { type: 'stock'; ticker: string; tab: AnalysisTab }
  | { type: 'compare' }
  | { type: 'profile' }

type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
})

const decimalFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
})

const wholeNumberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
})

const currencyFormatterCache = new Map<string, Intl.NumberFormat>()

function App() {
  const { pathname, navigate } = usePathRouter()
  const route = useMemo(() => parseRoute(pathname), [pathname])
  const activeTicker = route.type === 'stock' ? route.ticker : null
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading')
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('theme')
      if (saved === 'dark' || saved === 'light') return saved
    } catch {}
    return 'light'
  })

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    try {
      localStorage.setItem('theme', theme)
    } catch { }
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => prev === 'dark' ? 'light' : 'dark')
  }, [])

  useEffect(() => {
    let cancelled = false

    fetchCurrentUser()
      .then((user) => {
        if (cancelled) {
          return
        }
        setAuthUser(user)
        setAuthStatus(user ? 'authenticated' : 'anonymous')
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        setAuthUser(null)
        setAuthStatus('anonymous')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const handleSearch = useCallback(
    (input: string) => {
      const ticker = normalizeTicker(input)
      if (!ticker) {
        return
      }

      navigate(`/stock/${encodeURIComponent(ticker)}/overview`)
    },
    [navigate],
  )

  const goHome = useCallback(() => {
    navigate('/')
  }, [navigate])

  const goCompare = useCallback(() => {
    navigate('/compare')
  }, [navigate])

  const goProfile = useCallback(() => {
    navigate('/profile')
  }, [navigate])

  const openAuthPage = useCallback(
    (mode: AuthMode) => {
      navigate(mode === 'signup' ? '/signup' : '/login')
    },
    [navigate],
  )

  const handleLogin = useCallback(
    async (values: { identifier: string; password: string }) => {
      const user = await loginUser(values.identifier, values.password)
      setAuthUser(user)
      setAuthStatus('authenticated')
      navigate('/')
    },
    [navigate],
  )

  const handleSignup = useCallback(
    async (values: {
      username: string
      email: string
      password: string
      confirmPassword: string
    }) => {
      const user = await registerUser(values)
      setAuthUser(user)
      setAuthStatus('authenticated')
      navigate('/')
    },
    [navigate],
  )

  const handleGoogleLogin = useCallback(
    async (credential: string, mode: AuthMode): Promise<GoogleAuthResult> => {
      const result = await loginWithGoogle(credential, mode)
      if (result.status === 'authenticated') {
        setAuthUser(result.user)
        setAuthStatus('authenticated')
        navigate('/')
      }
      return result
    },
    [navigate],
  )

  const handleGoogleSignupCompletion = useCallback(
    async (values: {
      username: string
      password: string
      confirmPassword: string
    }) => {
      const user = await completeGoogleSignup(values)
      setAuthUser(user)
      setAuthStatus('authenticated')
      navigate('/')
    },
    [navigate],
  )

  const handleLogout = useCallback(async () => {
    try {
      await logoutUser()
    } finally {
      setAuthUser(null)
      setAuthStatus('anonymous')
      navigate('/')
    }
  }, [navigate])

  const handleChangePassword = useCallback(
    async (values: {
      currentPassword: string
      newPassword: string
      confirmPassword: string
    }) => {
      await changeUserPassword(values)
    },
    [],
  )

  return (
    <div className="app-shell">
      <HeaderBar
        key={`${activeTicker ?? 'home'}-${authStatus}`}
        authStatus={authStatus}
        isAuthenticated={authStatus === 'authenticated'}
        showSearch={route.type === 'stock'}
        isCompareRoute={route.type === 'compare'}
        user={authUser}
        initialSearch={activeTicker ?? ''}
        theme={theme}
        onToggleTheme={toggleTheme}
        onAuthModeChange={openAuthPage}
        onLogout={handleLogout}
        onSearch={handleSearch}
        onHome={goHome}
        onCompare={goCompare}
        onProfile={goProfile}
      />

      <main className="content">
        {route.type === 'stock' ? (
          <AnalysisPage
            key={route.ticker}
            ticker={route.ticker}
            tab={route.tab}
            user={authUser}
            theme={theme}
            onTabChange={(tab) =>
              navigate(`/stock/${encodeURIComponent(route.ticker)}/${tab}`, {
                replace: true,
              })
            }
          />
        ) : route.type === 'compare' ? (
          <ComparePage />
        ) : route.type === 'auth' ? (
          <AuthPage
            authMode={route.mode}
            onAuthModeChange={openAuthPage}
            onLogin={handleLogin}
            onSignup={handleSignup}
            onGoogleAuth={handleGoogleLogin}
            onCompleteGoogleSignup={handleGoogleSignupCompletion}
          />
        ) : route.type === 'profile' ? (
          <ProfilePage
            authStatus={authStatus}
            user={authUser}
            onAuthModeChange={openAuthPage}
            onChangePassword={handleChangePassword}
          />
        ) : (
          <HomePage onSearch={handleSearch} onCompare={goCompare} user={authUser} />
        )}
      </main>
      <Footer />
    </div>
  )
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-content">
        <div className="footer-brand">
          <span className="footer-logo">StockInsight</span>
          <p className="footer-tagline">Advanced fundamental analysis and semantic intelligence for the modern investor.</p>
        </div>
        <div className="footer-links">
          <div className="footer-col">
            <h4>Platform</h4>
            <a href="#">Analysis</a>
            <a href="#">Sentiment</a>
            <a href="#">Screener</a>
          </div>
          <div className="footer-col">
            <h4>Resources</h4>
            <a href="#">Documentation</a>
            <a href="#">Security</a>
            <a href="#">Market News</a>
          </div>
          <div className="footer-col">
            <h4>Company</h4>
            <a href="#">About Us</a>
            <a href="#">Contact</a>
            <a href="#">Terms & Privacy</a>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <p>&copy; {new Date().getFullYear()} StockInsight. All rights reserved.</p>
        <p className="footer-disclaimer">
          Data provided is for informational purposes only and does not constitute financial or investment advice.
        </p>
      </div>
    </footer>
  )
}

type HeaderBarProps = {
  authStatus: AuthStatus
  isAuthenticated: boolean
  initialSearch: string
  isCompareRoute: boolean
  onAuthModeChange: (mode: AuthMode) => void
  onLogout: () => void
  onProfile: () => void
  onSearch: (ticker: string) => void
  onHome: () => void
  onCompare: () => void
  showSearch: boolean
  user: AuthUser | null
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}

function HeaderBar({
  authStatus,
  isAuthenticated,
  initialSearch,
  isCompareRoute,
  onAuthModeChange,
  onLogout,
  onProfile,
  onSearch,
  onHome,
  onCompare,
  showSearch,
  user,
  theme,
  onToggleTheme,
}: HeaderBarProps) {
  const [isHidden, setIsHidden] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const lastScrollYRef = useRef(0)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onScroll = () => {
      const currentScrollY = window.scrollY
      const previousScrollY = lastScrollYRef.current

      if (currentScrollY <= 24) {
        setIsHidden(false)
      } else if (currentScrollY > previousScrollY && currentScrollY > 96) {
        setIsHidden(true)
        setIsMenuOpen(false) // Close menu on scroll hide
      } else if (currentScrollY < previousScrollY) {
        setIsHidden(false)
      }

      lastScrollYRef.current = currentScrollY
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false)
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('mousedown', handleClickOutside)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const toggleMenu = () => setIsMenuOpen((prev) => !prev)

  return (
    <header className={`top-bar${isHidden ? ' is-hidden' : ''}`}>
      <button className="brand" type="button" onClick={onHome}>
        StockInsight
      </button>
      {showSearch ? (
        <StockSearchForm
          className="top-search"
          initialValue={initialSearch}
          onSearch={onSearch}
          placeholder="Search company or ticker"
          ariaLabel="Search company or ticker"
          buttonLabel="Search"
        />
      ) : (
        <div className="top-search-placeholder" aria-hidden="true" />
      )}
      <div className="top-actions" ref={menuRef}>
        <button
          type="button"
          className="compare-nav-btn"
          onClick={isCompareRoute ? onHome : onCompare}
        >
          {isCompareRoute ? 'Search Ticker' : 'Compare'}
        </button>

        <div className="top-user-wrap">
          <button
            type="button"
            className={`menu-toggle-btn${isMenuOpen ? ' is-active' : ''}`}
            onClick={toggleMenu}
            aria-label="Toggle user menu"
          >
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              stroke="currentColor"
              strokeWidth="1.8"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </button>

          {isMenuOpen && (
            <div className="top-dropdown-menu">
              {isAuthenticated && (
                <div className="dropdown-user-info">
                  <span className="user-label">Signed in as</span>
                  <span className="user-name">{user?.username ?? 'user'}</span>
                </div>
              )}

              <button
                type="button"
                className="dropdown-item theme-item"
                onClick={() => {
                  onToggleTheme()
                  setIsMenuOpen(false)
                }}
              >
                <span className="icon">{theme === 'dark' ? '☀️' : '🌙'}</span>
                {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              </button>

              <div className="dropdown-divider" />

              {authStatus === 'loading' ? (
                <div className="dropdown-status">Restoring session...</div>
              ) : isAuthenticated ? (
                <>
                  <button
                    type="button"
                    className="dropdown-item"
                    onClick={() => {
                      onProfile()
                      setIsMenuOpen(false)
                    }}
                  >
                    Profile
                  </button>
                  <button
                    type="button"
                    className="dropdown-item logout-item"
                    onClick={() => {
                      onLogout()
                      setIsMenuOpen(false)
                    }}
                  >
                    Log Out
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="dropdown-item"
                    onClick={() => {
                      onAuthModeChange('login')
                      setIsMenuOpen(false)
                    }}
                  >
                    Log In
                  </button>
                  <button
                    type="button"
                    className="dropdown-item signup-item"
                    onClick={() => {
                      onAuthModeChange('signup')
                      setIsMenuOpen(false)
                    }}
                  >
                    Create Account
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}


function HomePulseSparkline({ data, color }: { data: number[]; color: string }) {
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const width = 48
  const height = 16
  const points = data.map((d, i) => `${(i / (data.length - 1)) * width},${height - ((d - min) / range) * height}`).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 -2 ${width} ${height + 4}`} className="indicator-mini-sparkline" fill="none" xmlns="http://www.w3.org/2000/svg">
      <polyline points={points} stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function HomeSnapshotTile({ ticker, name, price, change, onSelect }: { ticker: string, name: string, price: string, change: number, onSelect: (t: string) => void }) {
  const isUp = change >= 0
  const colorClass = isUp ? 'text-soft-mint' : 'text-soft-coral'
  const sign = isUp ? '+' : ''
  return (
    <button type="button" className="hp-snapshot-tile" onClick={() => onSelect(ticker)}>
      <div className="hp-snapshot-header">
        <span className="hp-snapshot-ticker">{ticker}</span>
        <span className={`hp-snapshot-change ${colorClass}`}>{sign}{change.toFixed(2)}%</span>
      </div>
      <p className="hp-snapshot-name">{name}</p>
      <p className="hp-snapshot-price">{price}</p>
    </button>
  )
}

type HomePageProps = {
  onSearch: (ticker: string) => void
  onCompare: () => void
  user: AuthUser | null
}

function HomePage({ onSearch, onCompare, user }: HomePageProps) {
  const greeting = user
    ? `Welcome back, ${user.username}. `
    : ''

  const indianIndices = [
    { name: 'Nifty 50', value: '22,453.15', change: 0.85, data: [1.0, 1.1, 1.3, 1.2, 1.4, 1.6, 1.5, 1.7, 1.9, 2.0, 1.9] },
    { name: 'Sensex', value: '74,119.39', change: 0.72, data: [2.0, 2.1, 2.0, 2.2, 2.3, 2.2, 2.4, 2.3, 2.5, 2.6, 2.5] },
    { name: 'Nifty Bank', value: '47,812.10', change: 1.12, data: [0.5, 0.7, 0.6, 0.9, 1.0, 1.2, 1.1, 1.3, 1.5, 1.4, 1.6] }
  ]

  const globalIndices = [
    { name: 'S&P 500', value: '5,123.41', change: 1.25, data: [1.1, 1.2, 1.0, 1.4, 1.3, 1.6, 1.8, 1.6, 1.9, 2.1, 2.0] },
    { name: 'Nasdaq', value: '16,211.02', change: 1.52, data: [2.1, 2.3, 2.1, 2.5, 2.4, 2.7, 2.9, 2.8, 3.1, 3.0, 3.2] },
    { name: 'Dow', value: '38,987.32', change: -0.41, data: [5.1, 5.0, 5.2, 4.9, 4.8, 4.7, 4.9, 4.6, 4.5, 4.4, 4.3] }
  ]

  const trending = [
    { ticker: 'NVDA', name: 'NVIDIA Corp.', price: '$850.12', change: 4.52 },
    { ticker: 'AAPL', name: 'Apple Inc.', price: '$178.41', change: -1.21 },
    { ticker: 'MSFT', name: 'Microsoft Corp.', price: '$420.55', change: 2.14 },
    { ticker: 'TSLA', name: 'Tesla Inc.', price: '$172.90', change: -3.45 }
  ]

  return (
    <div className="home-container">
      <section className="hero">
        <div className="hero-single">
          <div className="hero-single-bg" aria-hidden="true" />
          <img src="/stockinsight_logo.svg" alt="StockInsight Logo" className="hero-logo" />
          {greeting && <p className="hero-greeting">{greeting}</p>}
          <StockSearchForm
            className="hero-search"
            onSearch={onSearch}
            placeholder="e.g. AAPL, TSLA, Microsoft..."
            ariaLabel="Search for a company or ticker"
            buttonLabel="Analyze"
          />

          <div className="market-pulse-strip indian-market-pulse">
            {indianIndices.map(idx => {
              const isUp = idx.change >= 0
              const colorVal = isUp ? 'var(--soft-mint)' : 'var(--soft-coral)'
              const colorCls = isUp ? 'text-soft-mint' : 'text-soft-coral'
              return (
                <div key={idx.name} className="market-pulse-item">
                  <span className="pulse-idx-name">{idx.name}</span>
                  <span className="pulse-idx-val">{idx.value}</span>
                  <span className={`pulse-idx-change ${colorCls}`}>
                    {isUp ? '+' : ''}{idx.change}%
                  </span>
                  <HomePulseSparkline data={idx.data} color={colorVal} />
                </div>
              )
            })}
          </div>

          <div className="market-pulse-strip global-market-pulse">
            {globalIndices.map(idx => {
              const isUp = idx.change >= 0
              const colorVal = isUp ? 'var(--soft-mint)' : 'var(--soft-coral)'
              const colorCls = isUp ? 'text-soft-mint' : 'text-soft-coral'
              return (
                <div key={idx.name} className="market-pulse-item">
                  <span className="pulse-idx-name">{idx.name}</span>
                  <span className="pulse-idx-val">{idx.value}</span>
                  <span className={`pulse-idx-change ${colorCls}`}>
                    {isUp ? '+' : ''}{idx.change}%
                  </span>
                  <HomePulseSparkline data={idx.data} color={colorVal} />
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="hp-quick-entry-section">
        <div className="hp-quick-entry-grid">
          <div className="hp-trending-block">
            <h3 className="hp-block-title">Trending Tickers</h3>
            <div className="hp-trending-tiles">
              {trending.map(t => (
                <HomeSnapshotTile key={t.ticker} {...t} onSelect={onSearch} />
              ))}
            </div>
          </div>
          <div className="hp-compare-cta-block">
            <h3 className="hp-block-title">Deep Comparison</h3>
            <div className="hp-compare-card">
              <div className="hp-compare-visual">
                <div className="hp-vs-ticker hp-vs-blue">AMD</div>
                <div className="hp-vs-badge">VS</div>
                <div className="hp-vs-ticker hp-vs-green">NVDA</div>
              </div>
              <h4>Compare Multiple Stocks</h4>
              <p>Place companies side-by-side to immediately contrast fundamental rigor, real-time sentiment, and technical momentum.</p>
              <button type="button" className="compare-cta-btn" onClick={onCompare}>
                Start a Comparison →
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="hp-pillars-section">
        <h2 className="hp-section-title">Why StockInsight?</h2>
        <div className="hp-pillars-grid">
          <div className="hp-pillar-card">
            <div className="hp-pillar-icon">📊</div>
            <h3>Fundamental Rigor</h3>
            <p>Deep-dive enterprise valuation metrics. Uncover underlying financial strength with sector-normalized ratios and growth history.</p>
          </div>
          <div className="hp-pillar-card">
            <div className="hp-pillar-icon">📈</div>
            <h3>Technical Precision</h3>
            <p>Advanced charting with moving averages, momentum indicators, and sophisticated candlestick pattern analysis to time your entry.</p>
          </div>
          <div className="hp-pillar-card">
            <div className="hp-pillar-icon">🧠</div>
            <h3>Sentiment Intelligence</h3>
            <p>Our NLP engine aggregates live news and scores semantic polarity. Gain a critical edge by understanding behavioral market buzz.</p>
          </div>
        </div>
      </section>
    </div>
  )
}

function CompareSparkline({ ohlcv, color }: { ohlcv: OhlcvPoint[]; color: string }) {
  if (!ohlcv || ohlcv.length === 0) return null
  const closes = ohlcv.map((p) => p.close)
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const range = max - min || 1
  const width = 120
  const height = 40
  const points = closes.map((c, i) => `${(i / (closes.length - 1)) * width},${height - ((c - min) / range) * height}`).join(' ')
  return (
    <svg width="100%" height={height} viewBox={`0 -4 ${width} ${height + 8}`} className="compare-sparkline" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
      <polyline points={points} stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function getBestMetrics(results: ComparisonResponse | null, orderedTickers: string[]) {
  const metrics = {
    overallScore: { val: -Infinity, ticker: '' },
    pe: { val: Infinity, ticker: '' },
    roe: { val: -Infinity, ticker: '' },
    debtToEquity: { val: Infinity, ticker: '' },
    revenueGrowth: { val: -Infinity, ticker: '' },
    earningsGrowth: { val: -Infinity, ticker: '' },
    profitMargins: { val: -Infinity, ticker: '' },
    forwardPE: { val: Infinity, ticker: '' },
    priceToBook: { val: Infinity, ticker: '' },
    currentRatio: { val: -Infinity, ticker: '' },
    fundamental: { val: -Infinity, ticker: '' },
    technical: { val: -Infinity, ticker: '' },
    sentiment: { val: -Infinity, ticker: '' },
    rsi: { val: -Infinity, ticker: '' },
    prox52WHigh: { val: -Infinity, ticker: '' },
    prox52WLow: { val: -Infinity, ticker: '' },
  }

  if (!results) return metrics

  for (const t of orderedTickers) {
    const r = results.results[t]
    if (!r || 'error' in r) continue
    const res = r as AnalysisResponse
    
    const os = res.overview.predictedScore ?? res.overview.overallScore
    if (os != null && os > metrics.overallScore.val) { metrics.overallScore = { val: os, ticker: t } }

    const pe = res.fundamental?.data?.trailingPE
    if (pe != null && pe > 0 && pe < metrics.pe.val) { metrics.pe = { val: pe, ticker: t } }

    const roe = res.fundamental?.data?.returnOnEquity
    if (roe != null && roe > metrics.roe.val) { metrics.roe = { val: roe, ticker: t } }

    const de = res.fundamental?.data?.debtToEquity
    if (de != null && de >= 0 && de < metrics.debtToEquity.val) { metrics.debtToEquity = { val: de, ticker: t } }

    const rg = res.fundamental?.data?.revenueGrowth
    if (rg != null && rg > metrics.revenueGrowth.val) { metrics.revenueGrowth = { val: rg, ticker: t } }

    const eg = res.fundamental?.data?.earningsGrowth
    if (eg != null && eg > metrics.earningsGrowth.val) { metrics.earningsGrowth = { val: eg, ticker: t } }

    const pm = res.fundamental?.data?.profitMargins
    if (pm != null && pm > metrics.profitMargins.val) { metrics.profitMargins = { val: pm, ticker: t } }

    const fpe = res.fundamental?.data?.forwardPE
    if (fpe != null && fpe > 0 && fpe < metrics.forwardPE.val) { metrics.forwardPE = { val: fpe, ticker: t } }

    const pb = res.fundamental?.data?.priceToBook
    if (pb != null && pb > 0 && pb < metrics.priceToBook.val) { metrics.priceToBook = { val: pb, ticker: t } }

    const cr = res.fundamental?.data?.currentRatio
    if (cr != null && cr > metrics.currentRatio.val) { metrics.currentRatio = { val: cr, ticker: t } }

    const fs = res.overview.fundamentalScore
    if (fs != null && fs > metrics.fundamental.val) { metrics.fundamental = { val: fs, ticker: t } }

    const ts = res.overview.technicalScore
    if (ts != null && ts > metrics.technical.val) { metrics.technical = { val: ts, ticker: t } }

    const ss = res.overview.sentimentScore
    if (ss != null && ss > metrics.sentiment.val) { metrics.sentiment = { val: ss, ticker: t } }

    const rsi = res.technical?.indicators?.RSI
    if (rsi != null && rsi > metrics.rsi.val) { metrics.rsi = { val: rsi, ticker: t } }

    const price = res.fundamental?.data?.currentPrice ?? res.technical?.indicators?.close
    const high52 = res.fundamental?.data?.['52WeekHigh']
    const low52 = res.fundamental?.data?.['52WeekLow']

    if (price != null && high52 != null && high52 > 0) {
      const proxH = price / high52
      if (proxH > metrics.prox52WHigh.val) { metrics.prox52WHigh = { val: proxH, ticker: t } }
    }
    
    if (price != null && low52 != null && low52 > 0) {
      const proxL = price / low52
      if (proxL > metrics.prox52WLow.val) { metrics.prox52WLow = { val: proxL, ticker: t } }
    }
  }

  return metrics
}

function CompareCard({
  ticker,
  result,
  error,
  bestMetrics,
  onRemove,
  onView
}: {
  ticker: string
  result: AnalysisResponse | null
  error: string | null
  bestMetrics: ReturnType<typeof getBestMetrics>
  onRemove: () => void
  onView: () => void
}) {
  if (error || !result) {
    return (
      <div className="compare-card error-card">
        <div className="cc-header-top">
          <h3>{ticker}</h3>
          <button type="button" className="cc-remove" onClick={onRemove}>×</button>
        </div>
        <p className="cc-error">{error ?? 'Loading...'}</p>
      </div>
    )
  }

  const fd = result.fundamental?.data
  const td = result.technical
  const ov = result.overview
  const sd = result.sentiment

  const price = fd?.currentPrice ?? td?.indicators?.close
  const currency = fd?.currency ?? td?.currency ?? 'USD'
  
  const isBestOS = bestMetrics.overallScore.ticker === ticker
  const isBestPE = bestMetrics.pe.ticker === ticker
  const isBestROE = bestMetrics.roe.ticker === ticker
  const isBestDE = bestMetrics.debtToEquity.ticker === ticker
  const isBestRG = bestMetrics.revenueGrowth.ticker === ticker
  const isBestEG = bestMetrics.earningsGrowth.ticker === ticker
  const isBestPM = bestMetrics.profitMargins.ticker === ticker
  const isBestFPE = bestMetrics.forwardPE.ticker === ticker
  const isBestPB = bestMetrics.priceToBook.ticker === ticker
  const isBestCR = bestMetrics.currentRatio.ticker === ticker
  const isBestRSI = bestMetrics.rsi.ticker === ticker
  const isBest52H = bestMetrics.prox52WHigh.ticker === ticker
  const isBest52L = bestMetrics.prox52WLow.ticker === ticker

  const toneColor = toneFromVerdict(ov.verdict) === 'positive' ? 'var(--soft-mint)' : toneFromVerdict(ov.verdict) === 'negative' ? 'var(--soft-coral)' : 'var(--muted)'

  const formatVal = (v: number | undefined | null, type: 'pct' | 'num' | 'curr' = 'num', curr = 'USD') => {
    if (v == null) return '—'
    if (type === 'pct') return `${(v * 100).toFixed(1)}%`
    if (type === 'curr') return formatCurrency(v, curr)
    return v.toFixed(2)
  }

  return (
    <div className="compare-card">
      <div className="cc-header">
        <div className="cc-header-top">
          <div className="cc-title">
            <h3>{ticker}</h3>
            <span className="cc-name" title={fd?.shortName ?? fd?.longName}>{fd?.shortName ?? fd?.longName ?? ticker}</span>
          </div>
          <button type="button" className="cc-remove" onClick={onRemove} aria-label={`Remove ${ticker}`}>×</button>
        </div>
        <div className="cc-price-row">
          <span className="cc-price">{formatVal(price, 'curr', currency)}</span>
          <span className={`cc-score ${isBestOS ? 'best-metric' : ''}`}>
             ML Prediction: <strong className={`tone-${toneFromVerdict(ov.verdict)}`}>{(ov.predictedScore ?? ov.overallScore).toFixed(1)}</strong>
          </span>
        </div>
        <div className={`cc-verdict tone-${toneFromVerdict(ov.verdict)}`}>{ov.verdict}</div>
      </div>

      <div className="cc-sparkline-container">
        {td?.ohlcv && <CompareSparkline ohlcv={td.ohlcv.slice(-30)} color={toneColor} />}
        <span className="cc-spark-label">30-Day Trend</span>
      </div>

      <div className="cc-section cc-scores-breakdown">
        <h4>Component Scores</h4>
        <div className="cc-metric-row">
          <span>Fundamental</span>
          <span className={`cc-val ${bestMetrics.fundamental.ticker === ticker ? 'best-metric' : ''}`}>{formatVal(ov.fundamentalScore)}</span>
        </div>
        <div className="cc-metric-row">
          <span>Technical</span>
          <span className={`cc-val ${bestMetrics.technical.ticker === ticker ? 'best-metric' : ''}`}>{formatVal(ov.technicalScore)}</span>
        </div>
        <div className="cc-metric-row">
          <span>Sentiment</span>
          <span className={`cc-val ${bestMetrics.sentiment.ticker === ticker ? 'best-metric' : ''}`}>{formatVal(ov.sentimentScore)}</span>
        </div>
        <div className="cc-metric-row">
          <span>Overall (Base)</span>
          <span className={`cc-val ${bestMetrics.overallScore.ticker === ticker ? 'best-metric' : ''}`}>{formatVal(ov.overallScore)}</span>
        </div>
      </div>

      <div className="cc-section">
        <h4>Valuation & Health</h4>
        <div className="cc-metric-row">
          <span>P/E (Trailing)</span>
          <span className={`cc-val ${isBestPE ? 'best-metric' : ''}`}>{formatVal(fd?.trailingPE)}</span>
        </div>
        <div className="cc-metric-row">
          <span>Forward P/E</span>
          <span className={`cc-val ${isBestFPE ? 'best-metric' : ''}`}>{formatVal(fd?.forwardPE)}</span>
        </div>
        <div className="cc-metric-row">
          <span>Price/Book</span>
          <span className={`cc-val ${isBestPB ? 'best-metric' : ''}`}>{formatVal(fd?.priceToBook)}</span>
        </div>
        <div className="cc-metric-row">
          <span>Debt/Equity</span>
          <span className={`cc-val ${isBestDE ? 'best-metric' : ''}`}>{formatVal(fd?.debtToEquity)}</span>
        </div>
        <div className="cc-metric-row">
          <span>Current Ratio</span>
          <span className={`cc-val ${isBestCR ? 'best-metric' : ''}`}>{formatVal(fd?.currentRatio)}</span>
        </div>
      </div>

      <div className="cc-section">
        <h4>Growth & Margins</h4>
        <div className="cc-metric-row">
          <span>Revenue Growth</span>
          <span className={`cc-val ${isBestRG ? 'best-metric' : ''}`}>{formatVal(fd?.revenueGrowth, 'pct')}</span>
        </div>
        <div className="cc-metric-row">
          <span>Earnings Growth</span>
          <span className={`cc-val ${isBestEG ? 'best-metric' : ''}`}>{formatVal(fd?.earningsGrowth, 'pct')}</span>
        </div>
        <div className="cc-metric-row">
          <span>Profit Margin</span>
          <span className={`cc-val ${isBestPM ? 'best-metric' : ''}`}>{formatVal(fd?.profitMargins, 'pct')}</span>
        </div>
        <div className="cc-metric-row">
          <span>ROE</span>
          <span className={`cc-val ${isBestROE ? 'best-metric' : ''}`}>{formatVal(fd?.returnOnEquity, 'pct')}</span>
        </div>
      </div>

      <div className="cc-section">
        <h4>Technical & Momentum</h4>
        <div className="cc-metric-row">
          <span>Trend / Signal</span>
          <span className="cc-val">{td?.trend ?? '—'} / {td?.signal ?? '—'}</span>
        </div>
        <div className="cc-metric-row">
          <span>RSI</span>
          <span className={`cc-val ${isBestRSI ? 'best-metric' : ''}`}>{formatVal(td?.indicators?.RSI)}</span>
        </div>
        <div className="cc-metric-row">
          <span title="Highlighted if closest to 52W High">52W High</span>
          <span className={`cc-val ${isBest52H ? 'best-metric' : ''}`}>{formatVal(fd?.['52WeekHigh'], 'curr', currency)}</span>
        </div>
        <div className="cc-metric-row">
          <span title="Highlighted if furthest from 52W Low">52W Low</span>
          <span className={`cc-val ${isBest52L ? 'best-metric' : ''}`}>{formatVal(fd?.['52WeekLow'], 'curr', currency)}</span>
        </div>
      </div>

      <div className="cc-section">
        <h4>Sentiment</h4>
        <div className="cc-metric-row">
          <span>Sentiment</span>
          <span className="cc-val">
            {ov.sentimentScore != null ? (ov.sentimentScore >= 55 ? 'Positive' : ov.sentimentScore <= 45 ? 'Negative' : 'Neutral') : '—'}
          </span>
        </div>
        <div className="cc-metric-row">
          <span>Articles Analyzed</span>
          <span className="cc-val">{sd?.data?.count ?? 0}</span>
        </div>
      </div>

      <button className="cc-view-btn" onClick={onView}>View Full Analysis</button>
    </div>
  )
}

function ComparePage() {
  const [tickers, setTickers] = useState<string[]>(() => {
    try {
      const saved = sessionStorage.getItem('compareTickers')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const [results, setResults] = useState<ComparisonResponse | null>(() => {
    try {
      const saved = sessionStorage.getItem('compareResults')
      return saved ? (JSON.parse(saved) as ComparisonResponse) : null
    } catch {
      return null
    }
  })
  const [timestamp, setTimestamp] = useState<number | null>(() => {
    try {
      const saved = sessionStorage.getItem('compareTimestamp')
      return saved ? parseInt(saved, 10) : null
    } catch {
      return null
    }
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(() => sessionStorage.getItem('compareError') ?? '')
  const [report, setReport] = useState<string | null>(() => sessionStorage.getItem('compareReport'))
  const [isReportLoading, setIsReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    sessionStorage.setItem('compareTickers', JSON.stringify(tickers))
  }, [tickers])

  useEffect(() => {
    if (results) {
      sessionStorage.setItem('compareResults', JSON.stringify(results))
      return
    }
    sessionStorage.removeItem('compareResults')
  }, [results])

  useEffect(() => {
    if (timestamp) {
      sessionStorage.setItem('compareTimestamp', timestamp.toString())
    } else {
      sessionStorage.removeItem('compareTimestamp')
    }
  }, [timestamp])

  useEffect(() => {
    if (error) {
      sessionStorage.setItem('compareError', error)
      return
    }
    sessionStorage.removeItem('compareError')
  }, [error])

  useEffect(() => {
    if (report) {
      sessionStorage.setItem('compareReport', report)
    } else {
      sessionStorage.removeItem('compareReport')
    }
  }, [report])

  const addTicker = useCallback((raw: string) => {
    const ticker = raw.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, '')
    if (!ticker) return
    setTickers((prev) => {
      if (prev.includes(ticker)) return prev
      if (prev.length >= 10) return prev
      return [...prev, ticker]
    })
  }, [])

  const removeTicker = useCallback((ticker: string) => {
    setTickers((prev) => prev.filter((t) => t !== ticker))
  }, [])

  const handleRun = useCallback(async () => {
    if (tickers.length < 2) return
    setIsLoading(true)
    setError('')
    setResults(null)
    setTimestamp(null)
    setReport(null)
    setReportError('')
    setElapsedSeconds(0)

    const startTime = Date.now()
    timerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)

    try {
      const response = await fetchComparisonAnalysis(tickers)
      setResults(response)
      setTimestamp(Date.now())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Comparison failed.')
    } finally {
      setIsLoading(false)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [tickers])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const navigate = useCallback((path: string) => {
    window.history.pushState({}, '', path)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [])

  const orderedTickers = useMemo(() => {
    if (!results) return []
    return tickers.filter((t) => t in results.results)
  }, [tickers, results])

  const getResult = useCallback((ticker: string): AnalysisResponse | null => {
    if (!results) return null
    const entry = results.results[ticker]
    if (!entry || 'error' in entry) return null
    return entry as AnalysisResponse
  }, [results])

  const getError = useCallback((ticker: string): string | null => {
    if (!results) return null
    const entry = results.results[ticker]
    if (entry && 'error' in entry) return (entry as { error: string }).error
    return null
  }, [results])

  const bestMetrics = useMemo(() => getBestMetrics(results, orderedTickers), [results, orderedTickers])

  const handleGenerateReport = useCallback(async () => {
    if (!results || orderedTickers.length < 2) return
    setIsReportLoading(true)
    setReportError('')
    try {
      const response = await fetchComparisonReport(orderedTickers, results.results as Record<string, unknown>)
      setReport(response.report)
    } catch (err: unknown) {
      setReportError(err instanceof Error ? err.message : 'Report generation failed.')
    } finally {
      setIsReportLoading(false)
    }
  }, [results, orderedTickers])

  useEffect(() => {
    if (results && orderedTickers.length >= 2 && !report && !isReportLoading && !reportError) {
      handleGenerateReport()
    }
  }, [results, orderedTickers, report, isReportLoading, reportError, handleGenerateReport])

  return (
    <section className="compare-page">
      <div className="compare-header reveal">
        <h1>Compare Stocks</h1>

        {tickers.length > 0 && (
          <div className="compare-ticker-chips">
            {tickers.map((t) => (
              <span key={t} className="compare-chip">
                {t}
                <button
                  type="button"
                  className="compare-chip-remove"
                  onClick={() => removeTicker(t)}
                  aria-label={`Remove ${t}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="compare-input-row">
          <StockSearchForm
            className="compare-search"
            clearOnSearch
            onSearch={addTicker}
            placeholder={tickers.length >= 10 ? 'Max 10 tickers' : 'Add a ticker...'}
            ariaLabel="Add ticker to comparison"
            buttonLabel="Add"
          />
        </div>
        <div className="compare-actions">
          <button
            type="button"
            className="compare-run-btn"
            onClick={handleRun}
            disabled={tickers.length < 2 || isLoading}
          >
            {isLoading ? `Analyzing... (${elapsedSeconds}s)` : 'Run Comparison'}
          </button>
          {tickers.length > 0 && !isLoading && (
            <button
              type="button"
              className="compare-clear-btn"
              onClick={() => { setTickers([]); setResults(null); setTimestamp(null); setError('') }}
            >
              Clear All
            </button>
          )}
        </div>
        {tickers.length > 0 && tickers.length < 2 && (
          <p className="compare-hint">Add at least 2 tickers to compare.</p>
        )}
        {results && !isLoading && timestamp && (
          <p className="compare-hint" style={{ marginTop: '0.75rem', opacity: 0.8 }}>
            Comparison generated at {new Date(timestamp).toLocaleTimeString()}. Click 'Run Comparison' for an updated analysis.
          </p>
        )}
      </div>

      {isLoading && (
        <div className="compare-loading reveal">
          <div className="compare-loading-spinner" />
          <p>Running parallel analysis for {tickers.length} stocks...</p>
          <p className="compare-loading-elapsed">{elapsedSeconds}s elapsed</p>
        </div>
      )}

      {error && !isLoading && (
        <div className="error-card reveal">
          <h2>Comparison failed</h2>
          <p>{error}</p>
          <button type="button" onClick={handleRun}>Retry</button>
        </div>
      )}

      {results && !isLoading && orderedTickers.length > 0 && (
        <div className="compare-results-container">
          {isReportLoading ? (
            <article className="panel reveal loading-panel" style={{ display: 'block', marginBottom: '1.5rem' }}>
              <header className="panel-head" style={{ marginBottom: '1rem' }}>
                <h2>AI Comparison Report</h2>
              </header>
              <div className="loading-lines">
                <span />
                <span />
                <span />
              </div>
            </article>
          ) : reportError ? (
            <div className="error-card reveal" style={{ marginBottom: '1.5rem' }}>
              <p>{reportError}</p>
              <button type="button" onClick={handleGenerateReport}>Retry Report Generation</button>
            </div>
          ) : report ? (() => {
            const isFallback = report.startsWith('Comparative analysis is currently unavailable')
            return (
              <article className="panel reveal" style={{ display: 'block', marginBottom: '1.5rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-sm)' }}>
                <header className="panel-head" style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h2 style={{ margin: 0, fontSize: '1.25rem' }}>AI Comparison Report</h2>
                  {isFallback && (
                    <button
                      type="button"
                      className="compare-run-btn"
                      style={{ padding: '0.35rem 0.9rem', fontSize: '0.85rem' }}
                      onClick={() => { setReport(null); handleGenerateReport() }}
                    >
                      Try again
                    </button>
                  )}
                </header>
                <div className="markdown-body" style={{ lineHeight: '1.6', fontSize: '0.95rem' }}>
                  <ReactMarkdown>{report}</ReactMarkdown>
                </div>
              </article>
            )
          })() : null}

          <div className="compare-results-cards reveal">
            {orderedTickers.map(t => (
              <CompareCard 
                key={t}
                ticker={t}
                result={getResult(t)}
                error={getError(t)}
                bestMetrics={bestMetrics}
                onRemove={() => removeTicker(t)}
                onView={() => navigate(`/stock/${encodeURIComponent(t)}/overview`)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

type AuthPageProps = {

  authMode: AuthMode
  onAuthModeChange: (mode: AuthMode) => void
  onLogin: (values: { identifier: string; password: string }) => Promise<void>
  onSignup: (values: {
    username: string
    email: string
    password: string
    confirmPassword: string
  }) => Promise<void>
  onGoogleAuth: (credential: string, mode: AuthMode) => Promise<GoogleAuthResult>
  onCompleteGoogleSignup: (values: {
    username: string
    password: string
    confirmPassword: string
  }) => Promise<void>
}

function AuthPage({
  authMode,
  onAuthModeChange,
  onLogin,
  onSignup,
  onGoogleAuth,
  onCompleteGoogleSignup,
}: AuthPageProps) {
  return (
    <section className="hero hero-grid">
      <div className="hero-single">
        <p className="kicker">Session Access</p>
        <h1>StockInsight</h1>
        <p>
          Sign in to save your session and return faster later. Public search and
          analysis stay available from the landing page.
        </p>
        <div className="auth-feature-list">
          <p>Use your username or email to access your account.</p>
          <p>Create an account if you want a persistent signed-in session.</p>
          <p>Return to the home page anytime to keep searching tickers publicly.</p>
        </div>
      </div>
      <AuthPanel
        mode={authMode}
        onModeChange={onAuthModeChange}
        onLogin={onLogin}
        onSignup={onSignup}
        onGoogleAuth={onGoogleAuth}
        onCompleteGoogleSignup={onCompleteGoogleSignup}
      />
    </section>
  )
}

type ProfilePageProps = {
  authStatus: AuthStatus
  user: AuthUser | null
  onAuthModeChange: (mode: AuthMode) => void
  onChangePassword: (values: {
    currentPassword: string
    newPassword: string
    confirmPassword: string
  }) => Promise<void>
}

function ProfilePage({
  authStatus,
  user,
  onAuthModeChange,
  onChangePassword,
}: ProfilePageProps) {
  const [formValues, setFormValues] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user) {
      setError('Please log in to manage your profile settings.')
      return
    }

    setError('')
    setNotice('')
    setIsSubmitting(true)
    try {
      await onChangePassword(formValues)
      setNotice('Password updated successfully.')
      setFormValues({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to update password right now.'
      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="hero hero-grid profile-page">
      <div className="hero-single">
        <p className="kicker">Account</p>
        <h1>Your Profile</h1>
        <p>Review your account details and keep your password secure.</p>
      </div>

      <div className="auth-card profile-card">
        {authStatus === 'loading' ? (
          <p className="auth-copy">Restoring session...</p>
        ) : !user ? (
          <>
            <p className="auth-error">You need to log in to access your profile.</p>
            <div className="cta-row profile-auth-actions">
              <button type="button" onClick={() => onAuthModeChange('login')}>
                Log In
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => onAuthModeChange('signup')}
              >
                Create Account
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="profile-summary">
              <div className="auth-field profile-static-field">
                <span>Username</span>
                <input value={user.username} readOnly />
              </div>
              <div className="auth-field profile-static-field">
                <span>Email</span>
                <input value={user.email || 'No email set'} readOnly />
              </div>
            </div>

            <div className="auth-divider">
              <span>Password</span>
            </div>

            <form className="auth-form" onSubmit={handleSubmit}>
              <p className="profile-password-note">
                If you signed up with Google and never set a password, leave current
                password blank.
              </p>
              <label className="auth-field">
                <span>Current Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={formValues.currentPassword}
                  onChange={(event) =>
                    setFormValues((current) => ({
                      ...current,
                      currentPassword: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="auth-field">
                <span>New Password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={formValues.newPassword}
                  onChange={(event) =>
                    setFormValues((current) => ({
                      ...current,
                      newPassword: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="auth-field">
                <span>Confirm New Password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={formValues.confirmPassword}
                  onChange={(event) =>
                    setFormValues((current) => ({
                      ...current,
                      confirmPassword: event.target.value,
                    }))
                  }
                />
              </label>
              {error && <p className="auth-error">{error}</p>}
              {notice && <p className="auth-notice">{notice}</p>}
              <button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Updating Password...' : 'Change Password'}
              </button>
            </form>
          </>
        )}
      </div>
    </section>
  )
}

type AnalysisPageProps = {
  ticker: string
  tab: AnalysisTab
  user: import('./types').AuthUser | null
  theme: 'light' | 'dark'
  onTabChange: (tab: AnalysisTab) => void
}

function AnalysisPage({ ticker, tab, user, theme, onTabChange }: AnalysisPageProps) {
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)
  const [isGeneratingReport, setIsGeneratingReport] = useState(false)

  useEffect(() => {
    let cancelled = false

    fetchAnalysis(ticker)
      .then((payload) => {
        if (!cancelled) {
          setAnalysis(payload)
          // If the analysis doesn't have a report yet, generate it statelessly
          if (!payload.reportSections || !payload.reportSections.overall) {
            setIsGeneratingReport(true)
            import('./api')
              .then(async ({ fetchAnalysisReport, setAnalysisCache }) => {
                const reportPayload = await fetchAnalysisReport(ticker, payload)
                return { reportPayload, setAnalysisCache }
              })
              .then(({ reportPayload, setAnalysisCache }) => {
                const nextAnalysis: AnalysisResponse = {
                  ...payload,
                  report: reportPayload.fullReport,
                  reportSections: reportPayload.sections,
                  reportSource: reportPayload.source,
                }

                // Persist generated report so re-opening the same ticker doesn't regenerate it.
                setAnalysisCache(ticker, nextAnalysis)

                if (!cancelled) {
                  setAnalysis(nextAnalysis)
                }
              })
              .catch((err) => {
                console.error('Failed to generate report', err)
              })
              .finally(() => {
                if (!cancelled) {
                  setIsGeneratingReport(false)
                }
              })
          }
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : 'Unable to fetch analysis.'
          setError(message)
          setAnalysis(null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [retryKey, ticker])

  const companyName = useMemo(() => {
    const data = analysis?.fundamental?.data
    if (!data) {
      return ''
    }
    return data.shortName ?? data.longName ?? ''
  }, [analysis])

  const priceInfo = useMemo(() => {
    if (!analysis) return null
    const currentPrice =
      analysis.fundamental?.data?.currentPrice ??
      analysis.technical?.data?.lastClose ??
      analysis.technical?.indicators?.close ??
      null
    if (!isFiniteNumber(currentPrice)) return null

    const ohlcv = analysis.technical?.data?.ohlcv ?? analysis.technical?.ohlcv ?? []
    let previousClose: number | null = null
    if (ohlcv.length >= 2) {
      const prev = ohlcv[ohlcv.length - 2]?.close
      if (isFiniteNumber(prev)) previousClose = prev
    }
    const change = previousClose !== null ? currentPrice - previousClose : null
    const changePercent = change !== null && previousClose !== null && previousClose !== 0 ? (change / previousClose) * 100 : null
    const currency = resolveAnalysisCurrency(analysis)
    return { currentPrice, change, changePercent, currency }
  }, [analysis])

  const exchangeName = useMemo(() => {
    const data = analysis?.fundamental?.data
    if (!data) return 'Ticker Detail'
    return data.fullExchangeName ?? data.exchange ?? 'Ticker Detail'
  }, [analysis])

  return (
    <section className="analysis-layout">
      <div className="analysis-header reveal">
        <div>
          <p className="kicker">{exchangeName}</p>
          <h1>{companyName ? `${companyName} (${ticker})` : ticker}</h1>
        </div>
        {priceInfo && (
          <div className="ticker-price-block">
            <span className="ticker-current-price">
              {formatCurrency(priceInfo.currentPrice, priceInfo.currency)}
            </span>
            {priceInfo.change !== null && priceInfo.changePercent !== null && (
              <span className={`ticker-price-change ${priceInfo.change >= 0 ? 'positive' : 'negative'}`}>
                <span className="ticker-price-arrow" aria-hidden="true">
                  {priceInfo.change >= 0 ? '▲' : '▼'}
                </span>
                {priceInfo.change >= 0 ? '+' : ''}{decimalFormatter.format(priceInfo.change)}
                {' '}({priceInfo.change >= 0 ? '+' : ''}{priceInfo.changePercent.toFixed(2)}%)
              </span>
            )}
          </div>
        )}
      </div>

      <nav className="analysis-tabs reveal" aria-label="Analysis sections">
        {ANALYSIS_TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={item.key === tab ? 'active' : ''}
            onClick={() => onTabChange(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {isLoading && tab !== 'discussion' && <LoadingPanel tab={tab} />}

      {!isLoading && error && (
        <div className="error-card reveal">
          <h2>Analysis unavailable</h2>
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              setIsLoading(true)
              setError('')
              setRetryKey((value) => value + 1)
            }}
          >
            Retry
          </button>
        </div>
      )}

      {tab === 'discussion' ? (
        <DiscussionSection ticker={ticker} user={user} theme={theme} />
      ) : (
        !isLoading && !error && analysis && renderSection(tab, analysis, ticker, isGeneratingReport, user, theme)
      )}
    </section>
  )
}

type OverviewSectionProps = {
  overview: AnalysisResponse['overview']
  llmSummary?: string
  technical?: TechnicalResult | null
  sentiment?: SentimentResult | null
  sentimentLlm?: string
  ticker?: string
  displayCurrency?: string
  theme?: 'light' | 'dark'
}

function OverviewSection({ overview, llmSummary, technical, sentimentLlm, ticker, displayCurrency, theme }: OverviewSectionProps) {
  const summary =
    llmSummary?.trim() ||
    'Composite score blends fundamental, technical, and sentiment signals into one decision-oriented output.'

  const overviewChartRef = useRef<HTMLDivElement | null>(null)
  const [isOverviewChartReady, setIsOverviewChartReady] = useState(false)
  const [ovChartType, setOvChartType] = useState<ChartType>('candle')
  const [ovChartDuration, setOvChartDuration] = useState<string>('1M')
  const [ovChartData, setOvChartData] = useState<any[]>([])
  const [ovChartCurrency, setOvChartCurrency] = useState<string | null>(null)
  const [isOvChartLoading, setIsOvChartLoading] = useState(false)
  const [ovChartFetchError, setOvChartFetchError] = useState('')

  const fallbackOhlcv = useMemo(() => {
    if (!technical) return []
    const data = resolveTechnicalData(technical)
    return data.ohlcv ?? []
  }, [technical])

  const overviewCurrency = displayCurrency ?? 'USD'
  const activeCurrency = ovChartCurrency ? normalizeCurrencyCode(ovChartCurrency) : overviewCurrency

  const activeChartRows = useMemo(
    () => (ovChartData.length > 0 ? ovChartData : fallbackOhlcv),
    [ovChartData, fallbackOhlcv],
  )

  const chartPerformance = useMemo(() => {
    const closes = activeChartRows
      .map((point) => point?.close)
      .filter((value): value is number => isFiniteNumber(value))
    if (closes.length < 2 || closes[0] === 0) return null
    const start = closes[0]
    const end = closes[closes.length - 1]
    const change = end - start
    return { start, end, change, percent: (change / start) * 100 }
  }, [activeChartRows])

  const chartDirectionLabel =
    chartPerformance && chartPerformance.change > 0 ? 'Uptrend' : chartPerformance && chartPerformance.change < 0 ? 'Downtrend' : 'Sideways'

  const chartDirectionTone: InsightTone =
    chartPerformance && chartPerformance.change > 0 ? 'bullish' : chartPerformance && chartPerformance.change < 0 ? 'bearish' : 'neutral'

  const livePrice = useMemo(() => {
    const latest = activeChartRows[activeChartRows.length - 1]?.close
    if (isFiniteNumber(latest)) return latest
    return null
  }, [activeChartRows])


  // Fetch chart data when duration changes
  useEffect(() => {
    if (!ticker) return
    let cancelled = false
    setIsOvChartLoading(true)
    setOvChartFetchError('')
    setOvChartCurrency(null)

    import('./api')
      .then(({ fetchChartData }) => fetchChartData(ticker, ovChartDuration))
      .then((payload) => {
        if (!cancelled) {
          setOvChartData(payload.ohlcv || [])
          setOvChartCurrency(payload.currency ?? null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setOvChartFetchError(err instanceof Error ? err.message : 'Failed to load chart data.')
          setOvChartData([])
        }
      })
      .finally(() => { if (!cancelled) setIsOvChartLoading(false) })

    return () => { cancelled = true }
  }, [ticker, ovChartDuration])

  // Init LightweightCharts
  useEffect(() => {
    const container = overviewChartRef.current
    if (!container || activeChartRows.length === 0) return

    let cancelled = false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let chart: any | null = null
    let resizeObserver: ResizeObserver | null = null

    const initChart = async () => {
      let lib = (window as any).LightweightCharts
      if (!lib) {
        const script = document.createElement('script')
        script.src =
          'https://unpkg.com/lightweight-charts@4.2.1/dist/lightweight-charts.standalone.production.js'
        script.async = true
        await new Promise<void>((resolve, reject) => {
          script.onload = () => resolve()
          script.onerror = () => reject(new Error('Failed to load chart library'))
          document.head.appendChild(script)
        })
        lib = (window as any).LightweightCharts
        if (!lib) return
      }
      if (cancelled) return

      const { width, height } = container.getBoundingClientRect()
      chart = lib.createChart(container, {
        width,
        height,
        layout: {
          background: { color: theme === 'dark' ? 'transparent' : 'white' },
          textColor: theme === 'dark' ? '#f8fafc' : '#111827',
        },
        rightPriceScale: { visible: true },
        timeScale: {
          borderColor: theme === 'dark' ? '#334155' : '#e5e7eb',
          timeVisible: true,
        },
        grid: {
          vertLines: { color: theme === 'dark' ? '#1e293b' : '#f3f4f6' },
          horzLines: { color: theme === 'dark' ? '#1e293b' : '#f3f4f6' },
        },
        localization: { locale: 'en-US', priceFormatter: (price: number) => formatCurrency(price, activeCurrency) },
        handleScroll: false,
        handleScale: false,
      })

      const ohlcv = activeChartRows
      let candles = ohlcv
        .map((bar) => {
          const t = bar.date
          const dt = typeof t === 'string' ? new Date(t) : new Date(t * 1000)
          if (Number.isNaN(dt.getTime())) return null
          return { time: dt.getTime() / 1000 as any, open: bar.open, high: bar.high, low: bar.low, close: bar.close }
        })
        .filter(Boolean) as Array<{ time: any; open: number; high: number; low: number; close: number }>

      candles.sort((a, b) => a.time - b.time)
      const uniqueCandles: typeof candles = []
      const seenTimes = new Set()
      for (const candle of candles) {
        if (!seenTimes.has(candle.time)) {
          seenTimes.add(candle.time)
          uniqueCandles.push(candle)
        }
      }
      candles = uniqueCandles

      const lineData = candles.map((c) => ({ time: c.time, value: c.close }))

      let series: any
      if (ovChartType === 'candle') {
        series = chart.addCandlestickSeries()
        series.setData(candles)
      } else if (ovChartType === 'bar') {
        series = chart.addBarSeries()
        series.setData(candles)
      } else if (ovChartType === 'area') {
        series = chart.addAreaSeries({
          lineColor: '#2962ff',
          topColor: 'rgba(41, 98, 255, 0.4)',
          bottomColor: 'rgba(41, 98, 255, 0.0)',
        })
        series.setData(lineData)
      } else {
        series = chart.addLineSeries({ color: '#2962ff' })
        series.setData(lineData)
      }

      chart.timeScale().fitContent()
      if (!cancelled) setIsOverviewChartReady(true)
      if (cancelled) { chart?.remove(); return }

      const resize = () => {
        if (!container || !chart) return
        const { width: w, height: h } = container.getBoundingClientRect()
        chart.applyOptions({ width: w, height: h })
      }
      resize()
      resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(container)
    }

    initChart().catch(() => {
      if (!cancelled) setIsOverviewChartReady(true)
    })

    return () => {
      cancelled = true
      if (resizeObserver && container) resizeObserver.unobserve(container)
      if (chart) chart.remove()
    }
  }, [activeChartRows, ovChartType, ovChartDuration, activeCurrency, theme])

  // News insights from sentiment
  const newsInsights = useMemo(() => {
    const sentimentText = sentimentLlm?.trim() || ''
    if (!sentimentText) return null
    const parsed = parseSentimentSummary(sentimentText)
    if (parsed.insights.length === 0) return null
    return parsed.insights
  }, [sentimentLlm])


  return (
    <article className={`panel reveal theme-${theme}`}>
      <header className="panel-head">
        <h2>Overall Analysis</h2>
        <span className={`verdict ${toneFromVerdict(overview.verdict)}`}>
          {overview.verdict}
        </span>
      </header>
      <p className="analysis-copy">{summary}</p>

      {/* Chart + Scores Layout */}
      {fallbackOhlcv.length > 0 && (
        <div className="overview-chart-layout">
          <div className="chart-block">
            <div className="chart-surface-head">
              <div className="chart-context">
                <div className="chart-context-main">
                  <div className="chart-symbol-price">
                    <h3>{ticker?.toUpperCase() ?? ''}</h3>
                    <span className="chart-live-price">
                      <span className="chart-live-dot" aria-hidden="true" />
                      {livePrice !== null ? formatCurrency(livePrice, activeCurrency) : 'N/A'}
                    </span>
                  </div>
                  <span className={`chart-delta tone-${chartDirectionTone}`}>
                    {chartPerformance
                      ? `${chartPerformance.change >= 0 ? '+' : ''}${chartPerformance.percent.toFixed(2)}%`
                      : 'N/A'}
                  </span>
                </div>
                <p className="chart-context-meta">
                  {chartPerformance
                    ? `${chartDirectionLabel} in ${ovChartDuration}: ${formatCurrency(chartPerformance.start, activeCurrency)} -> ${formatCurrency(chartPerformance.end, activeCurrency)}`
                    : 'Switch duration and chart style to inspect movement.'}
                </p>
              </div>
              <div className="chart-controls" aria-label="Chart controls">
                <div className="chart-type-selector">
                  {CHART_DURATION_OPTIONS.map((dur) => (
                    <button
                      key={dur}
                      type="button"
                      className={ovChartDuration === dur ? 'active' : ''}
                      onClick={() => setOvChartDuration(dur)}
                    >
                      {dur}
                    </button>
                  ))}
                </div>
                <ChartTypeSelect value={ovChartType} onChange={setOvChartType} />
              </div>
            </div>
            <div
              className={`tv-chart-shell${isOvChartLoading ? ' is-loading' : ''}${isOverviewChartReady ? ' is-ready' : ''}${ovChartFetchError ? ' has-error' : ''}`}
            >
              <div
                key={`ov-${ovChartType}-${ovChartDuration}`}
                className="tv-chart-wrap"
                ref={overviewChartRef}
              />
              {isOvChartLoading && (
                <div className="chart-overlay" role="status" aria-live="polite">
                  <span className="chart-loader-line" />
                  <p>Refreshing chart...</p>
                </div>
              )}
              {!isOvChartLoading && ovChartFetchError && (
                <div className="chart-overlay chart-overlay-error" role="status">
                  <p>{ovChartFetchError}</p>
                </div>
              )}
              {!isOvChartLoading && !ovChartFetchError && activeChartRows.length === 0 && (
                <div className="chart-overlay" role="status">
                  <p>No chart data available for this range.</p>
                </div>
              )}
            </div>
          </div>
          <div className="overview-scores-column">
            <div className={`overview-score-card verdict-card tone-${toneFromScore(overview.predictedScore, 65, 45)}`}>
              <span className="overview-score-label">Verdict</span>
              <strong className="overview-score-value">{overview.verdict}</strong>
              {overview.predictedScore !== null && (
                <span className="overview-score-band">
                  ML Prediction: {formatScore(overview.predictedScore)}
                </span>
              )}
            </div>
            <div className={`overview-score-card overall tone-${toneFromScore(overview.overallScore, 60, 40)}`}>
              <span className="overview-score-label">Overall Score</span>
              <strong className="overview-score-value">{formatScore(overview.overallScore)}</strong>
              <span className="overview-score-band">{scoreBand(overview.overallScore)}</span>
            </div>
            <div className="overview-score-card">
              <span className="overview-score-label">Fundamental</span>
              <strong className="overview-score-value">{formatScore(overview.fundamentalScore)}</strong>
              <span className="overview-score-band">{scoreBand(overview.fundamentalScore)}</span>
            </div>
            <div className="overview-score-card">
              <span className="overview-score-label">Technical</span>
              <strong className="overview-score-value">{formatScore(overview.technicalScore)}</strong>
              <span className="overview-score-band">{scoreBand(overview.technicalScore)}</span>
            </div>
            <div className="overview-score-card">
              <span className="overview-score-label">Sentiment</span>
              <strong className="overview-score-value">{formatScore(overview.sentimentScore)}</strong>
              <span className="overview-score-band">{scoreBand(overview.sentimentScore)}</span>
            </div>
          </div>
        </div>
      )}

      {/* News Insights Block */}
      {newsInsights && newsInsights.length > 0 && (
        <section className="sentiment-summary-card">
          <h3>Main Insights from news headlines</h3>
          <ul className="analysis-bullets">
            {newsInsights.map((item, index) => (
              <li key={`overview-insight-${index}`}>{item}</li>
            ))}
          </ul>
        </section>
      )}

    </article>
  )
}

type FundamentalSectionProps = {
  result: AnalysisResponse['fundamental']
  llmSummary?: string
  displayCurrency: string
  theme?: 'light' | 'dark'
}

function StackedBarBurn({ labelA, labelB, valA, valB, colorA, colorB }: { labelA: string, labelB: string, valA?: number, valB?: number, colorA: string, colorB: string }) {
  if (valA === undefined && valB === undefined) return null;
  const a = valA || 0;
  const b = valB || 0;
  const total = a + b;
  const percentA = total > 0 ? (a / total) * 100 : 0;
  const percentB = total > 0 ? (b / total) * 100 : 0;

  return (
    <div className="stacked-widget">
      <div className="stacked-track">
        <div className="stacked-fill" style={{ width: `${percentA}%`, backgroundColor: colorA }}></div>
        <div className="stacked-fill" style={{ width: `${percentB}%`, backgroundColor: colorB }}></div>
      </div>
      <div className="stacked-labels">
        <div className="stacked-label"><span className="swatch" style={{ backgroundColor: colorA }}></span>{labelA}: {a > 0 ? compactFormatter.format(a) : 'N/A'}</div>
        <div className="stacked-label"><span className="swatch" style={{ backgroundColor: colorB }}></span>{labelB}: {b > 0 ? compactFormatter.format(b) : 'N/A'}</div>
      </div>
    </div>
  )
}

const PIE_COLORS = ['#2563eb', '#10b981', '#cbd5e1']

function RechartsSizedContainer({
  height,
  children,
}: {
  height: number
  children: (size: { width: number; height: number }) => ReactNode
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const node = hostRef.current
    if (!node) {
      return
    }

    const measure = () => {
      const measured = Math.max(0, Math.floor(node.getBoundingClientRect().width))
      setWidth(measured)
    }

    measure()

    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => measure()
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }

    const observer = new ResizeObserver(() => measure())
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={hostRef} style={{ width: '100%', height: `${height}px` }}>
      {width > 0 ? children({ width, height }) : null}
    </div>
  )
}

function FundamentalSection({
  result,
  llmSummary,
  displayCurrency,
  theme,
}: FundamentalSectionProps) {
  const revRef = useRef<HTMLDivElement | null>(null)
  const isRevInView = useInViewOnce(revRef, { threshold: 0, rootMargin: '100px 0px' })

  const cashRef = useRef<HTMLDivElement | null>(null)
  const isCashInView = useInViewOnce(cashRef, { threshold: 0, rootMargin: '100px 0px' })

  const shareRef = useRef<HTMLDivElement | null>(null)
  const isShareInView = useInViewOnce(shareRef, { threshold: 0, rootMargin: '100px 0px' })

  const marginRef = useRef<HTMLDivElement | null>(null)
  const isMarginInView = useInViewOnce(marginRef, { threshold: 0, rootMargin: '100px 0px' })
  if (!result) {
    return (
      <UnavailablePanel title="Fundamental Analysis">
        Fundamental data is currently unavailable for this ticker.
      </UnavailablePanel>
    )
  }

  const data: FundamentalData = result.data
  const summary = llmSummary?.trim() || summarizeScore(result.score, 'fundamental')
  const summaryBullets = extractBulletPoints(summary)

  const fundScorePercent = isFiniteNumber(result.score) ? clampPercent(result.score) : 50
  const fundScoreZone = isFiniteNumber(result.score)
    ? result.score < 30 ? 'strong-bearish'
      : result.score < 45 ? 'bearish'
        : result.score < 55 ? 'neutral'
          : result.score < 70 ? 'bullish'
            : 'strong-bullish'
    : 'neutral'
  const fundSignalLabel = isFiniteNumber(result.score)
    ? result.score < 30 ? 'Weak'
      : result.score < 45 ? 'Below Avg'
        : result.score < 55 ? 'Average'
          : result.score < 70 ? 'Good'
            : 'Strong'
    : 'N/A'
  const chartBlue = resolveCssColorValue('var(--chart-blue)', '#2563eb')
  const chartGreen = resolveCssColorValue('var(--chart-green)', '#10b981')
  const chartSlate = resolveCssColorValue('var(--chart-slate)', '#94a3b8')
  const axisTickColor = resolveCssColorValue('var(--muted)', '#6b7280')
  const gridStrokeColor = resolveCssColorValue('var(--line)', '#e5e7eb')
  const revenueTrendData = (data.revenueTrend ?? []).map((row) => ({
    year: String(row.year),
    revenue: toFiniteOrNull(row.revenue),
    netProfit: toFiniteOrNull(row.netProfit),
  }))
  const cashflowTrendData = (data.cashflowTrend ?? []).map((row) => ({
    year: String(row.year),
    operatingCashFlow: toFiniteOrNull(row.operatingCashFlow),
    freeCashFlow: toFiniteOrNull(row.freeCashFlow),
  }))
  const marginsTrendData = (data.marginsTrend ?? []).map((row) => ({
    year: String(row.year),
    operatingMargin: toFiniteOrNull(row.operatingMargin),
    netMargin: toFiniteOrNull(row.netMargin),
  }))

  return (
    <article className={`panel reveal theme-${theme}`}>
      <header className="panel-head">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 style={{ margin: 0 }}>Fundamental Analysis</h2>
          {data.sector && (
            <span style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: '0.1rem' }}>
              Sector: {data.sector}{data.industry ? ` • ${data.industry}` : ''}
            </span>
          )}
        </div>
        <span className="score-tag">{formatScore(result.score)}</span>
      </header>
      {summaryBullets.length > 0 ? (
        <ul className="analysis-bullets">
          {summaryBullets.map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="analysis-copy">{summary}</p>
      )}

      <div className="market-hero">
        <div className="fund-hero-metric">
          <span className="label">P/E Ratio</span>
          <span className="val">{formatNumber(data.trailingPE)}</span>
        </div>
        <div className="fund-hero-metric">
          <span className="label">Market Cap</span>
          <span className="val">{data.marketCap ? compactFormatter.format(data.marketCap) : 'N/A'}</span>
        </div>
        <div className="fund-hero-metric">
          <span className="label">Ent. Value</span>
          <span className="val">{data.enterpriseValue ? compactFormatter.format(data.enterpriseValue) : 'N/A'}</span>
        </div>
        <div className="fund-hero-metric">
          <span className="label">Beta</span>
          <span className="val">{formatNumber(data.beta)}</span>
        </div>
        <div className={`fundamental-score-card tone-${scoreToTone(result.score)}`}>
          <h3 style={{ margin: 0, fontSize: '0.82rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>Fundamental Score</h3>
          <div className={`technical-score-meter-wrap zone-${fundScoreZone}`}>
            <div className="technical-score-meter-head">
              <span className="technical-score-signal">{fundSignalLabel}</span>
              <strong className="technical-score-value">{formatScore(result.score)}</strong>
            </div>
            <div className="technical-score-meter-visual" aria-hidden="true">
              <div className="technical-score-meter-track">
                <div className="technical-score-meter-segments">
                  <span className="segment strong-bearish" />
                  <span className="segment bearish" />
                  <span className="segment neutral" />
                  <span className="segment bullish" />
                  <span className="segment strong-bullish" />
                </div>
                <span
                  className="technical-score-meter-marker"
                  style={{ left: `${fundScorePercent}%` }}
                />
              </div>
              <div className="technical-score-meter-scale">
                {[0, 25, 50, 75, 100].map((tick) => (
                  <span
                    key={`fund-tick-${tick}`}
                    className={`technical-score-meter-tick${tick === 0 ? ' edge-start' : ''}${tick === 100 ? ' edge-end' : ''}`}
                    style={{ left: `${tick}%` }}
                  >
                    <span className="technical-score-meter-tick-mark" />
                    <span className="technical-score-meter-tick-label">{tick}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="fundamentals-grid">
        {/* Card 1: Valuation */}
        <div className="fund-card">
          <h3>Valuation</h3>
          <div className="fund-metrics">
            <div className="metric">
              <span className="label">P/E (Forward)</span>
              <span className="val">{formatNumber(data.forwardPE)}</span>
            </div>
            <div className="metric">
              <span className="label">PEG Ratio</span>
              <span className="val">{formatNumber(data.pegRatio)}</span>
            </div>
            <div className="metric">
              <span className="label">P/S (TTM)</span>
              <span className="val">{formatNumber(data.priceToSalesTrailing12Months)}</span>
            </div>
            <div className="metric">
              <span className="label">P/B Ratio</span>
              <span className="val">{formatNumber(data.priceToBook)}</span>
            </div>
            <div className="metric">
              <span className="label">EV/EBITDA</span>
              <span className="val">{formatNumber(data.enterpriseToEbitda)}</span>
            </div>
          </div>
        </div>



        {/* Card 4: Profitability */}
        <div className="fund-card">
          <h3>Profitability</h3>
          <div className="fund-metrics">
            <div className="metric">
              <span className="label">ROE</span>
              <span className="val"><ColoredValue value={data.returnOnEquity} formatFn={formatPercent} /></span>
            </div>
            <div className="metric">
              <span className="label">ROA</span>
              <span className="val"><ColoredValue value={data.returnOnAssets} formatFn={formatPercent} /></span>
            </div>
            <div className="metric">
              <span className="label">ROCE</span>
              <span className="val"><ColoredValue value={data.returnOnCapitalEmployed} formatFn={formatPercent} /></span>
            </div>
            <div className="metric">
              <span className="label">Operating Margin</span>
              <span className="val"><ColoredValue value={data.operatingMargins} formatFn={formatPercent} /></span>
            </div>
            <div className="metric">
              <span className="label">Net Margin</span>
              <span className="val"><ColoredValue value={data.profitMargins} formatFn={formatPercent} /></span>
            </div>
          </div>
        </div>

        {/* Card 5: Financial Health */}
        <div className="fund-card">
          <h3>Financial Health</h3>
          <StackedBarBurn
            labelA="Total Cash"
            labelB="Total Debt"
            valA={data.totalCash}
            valB={data.totalDebt}
            colorA="#10b981"
            colorB="#ef4444"
          />
          <div className="fund-metrics" style={{ marginTop: '1rem' }}>
            <div className="metric">
              <span className="label">Debt/Equity</span>
              <span className="val">{formatNumber(data.debtToEquity)}</span>
            </div>
            <div className="metric">
              <span className="label">Current Ratio</span>
              <span className="val">{formatNumber(data.currentRatio)}</span>
            </div>
            <div className="metric">
              <span className="label">Quick Ratio</span>
              <span className="val">{formatNumber(data.quickRatio)}</span>
            </div>
            <div className="metric">
              <span className="label">Interest Coverage</span>
              <span className="val">{formatNumber(data.interestCoverage)}</span>
            </div>
          </div>
        </div>

        {/* Card: Sector P/E Comparison */}
        {data.sectorPeersAnalysis && (
          <div className="fund-card" style={{ gridColumn: '1 / -1' }}>
            <h3>Sector P/E Comparison</h3>
            <div className="sector-pe-table-container" style={{ marginTop: '1rem', overflowX: 'auto' }}>
              <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Metric</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Raw Value</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Sector Mean</th>
                    <th style={{ padding: '0.75rem 0.5rem' }}>Relative Standing</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem 0.5rem', fontWeight: 500 }}>Trailing P/E</td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>{formatNumber(data.sectorPeersAnalysis.trailing.rawValue)}</td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>{formatNumber(data.sectorPeersAnalysis.trailing.sectorMean)}</td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <span style={{
                        padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600,
                        backgroundColor: 'rgba(0,0,0,0.05)',
                        color: data.sectorPeersAnalysis.trailing.relativeStandingLabel.toLowerCase().includes('under') ? '#10b981' : data.sectorPeersAnalysis.trailing.relativeStandingLabel.toLowerCase().includes('over') ? '#ef4444' : 'inherit'
                      }}>
                        {data.sectorPeersAnalysis.trailing.relativeStandingLabel}
                        {data.sectorPeersAnalysis.trailing.relativeStandingScore != null ? ` (${data.sectorPeersAnalysis.trailing.relativeStandingScore > 0 ? '+' : ''}${data.sectorPeersAnalysis.trailing.relativeStandingScore.toFixed(2)})` : ''}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '0.75rem 0.5rem', fontWeight: 500 }}>Forward P/E</td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>{formatNumber(data.sectorPeersAnalysis.forward.rawValue)}</td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>{formatNumber(data.sectorPeersAnalysis.forward.sectorMean)}</td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <span style={{
                        padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600,
                        backgroundColor: 'rgba(0,0,0,0.05)',
                        color: data.sectorPeersAnalysis.forward.relativeStandingLabel.toLowerCase().includes('under') ? '#10b981' : data.sectorPeersAnalysis.forward.relativeStandingLabel.toLowerCase().includes('over') ? '#ef4444' : 'inherit'
                      }}>
                        {data.sectorPeersAnalysis.forward.relativeStandingLabel}
                        {data.sectorPeersAnalysis.forward.relativeStandingScore != null ? ` (${data.sectorPeersAnalysis.forward.relativeStandingScore > 0 ? '+' : ''}${data.sectorPeersAnalysis.forward.relativeStandingScore.toFixed(2)})` : ''}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--muted)' }}>
                Based on top peers: {data.sectorPeersAnalysis.peers.slice(0, 10).join(', ')}{data.sectorPeersAnalysis.peers.length > 10 ? '...' : ''}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Growth & Dividends Strip */}
      <div className="growth-strip">
        <div className="growth-header">
          <h3>Growth & Dividends</h3>
        </div>
        <div className="growth-metrics">
          <div className="hero-metric">
            <span className="label">Revenue Growth</span>
            <span className="val"><ColoredValue value={data.revenueGrowth} formatFn={formatPercent} /></span>
          </div>
          <div className="hero-metric">
            <span className="label">Earnings Growth</span>
            <span className="val"><ColoredValue value={data.earningsGrowth} formatFn={formatPercent} /></span>
          </div>
          <div className="hero-metric">
            <span className="label">Gross Margin</span>
            <span className="val">{formatPercent(data.grossMargins)}</span>
          </div>
          <div className="hero-metric">
            <span className="label">Dividend Yield</span>
            <span className="val"><ColoredValue value={data.dividendYield} formatFn={formatPercent} /></span>
          </div>
          <div className="hero-metric">
            <span className="label">Payout Ratio</span>
            <span className="val">{formatPercent(data.payoutRatio)}</span>
          </div>
        </div>
      </div>

      <div className="charts-grid">
        {revenueTrendData.length > 0 && (
          <div className={`chart-card${isRevInView ? ' is-animated' : ''}`} ref={revRef}>
            <h3>Revenue & Net Profit</h3>
            <div className="recharts-wrapper">
              <RechartsSizedContainer height={250}>
                {({ width, height }) => (
                  <BarChart width={width} height={height} data={revenueTrendData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStrokeColor} />
                  <XAxis dataKey="year" tick={{ fill: axisTickColor, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(val) => compactFormatter.format(val)} tick={{ fill: axisTickColor, fontSize: 12 }} axisLine={false} tickLine={false} width={60} />
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <RechartsTooltip formatter={(val: any) => formatCurrency(Number(val), displayCurrency)} cursor={{ fill: 'rgba(0,0,0,0.05)' }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                  <Bar dataKey="revenue" name="Revenue" fill={chartSlate} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="netProfit" name="Net Profit" fill={chartBlue} radius={[4, 4, 0, 0]} />
                  </BarChart>
                )}
              </RechartsSizedContainer>
            </div>
          </div>
        )}

        {cashflowTrendData.length > 0 && (
          <div className={`chart-card${isCashInView ? ' is-animated' : ''}`} ref={cashRef}>
            <h3>Cash Flow Breakdown</h3>
            <div className="recharts-wrapper">
              <RechartsSizedContainer height={250}>
                {({ width, height }) => (
                  <AreaChart width={width} height={height} data={cashflowTrendData}>
                  <defs>
                    <linearGradient id="colorOp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chartBlue} stopOpacity={0.8} />
                      <stop offset="95%" stopColor={chartBlue} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorFcf" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chartGreen} stopOpacity={0.8} />
                      <stop offset="95%" stopColor={chartGreen} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStrokeColor} />
                  <XAxis dataKey="year" tick={{ fill: axisTickColor, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(val) => compactFormatter.format(val)} tick={{ fill: axisTickColor, fontSize: 12 }} axisLine={false} tickLine={false} width={60} />
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <RechartsTooltip formatter={(val: any) => formatCurrency(Number(val), displayCurrency)} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                  <Area type="monotone" dataKey="operatingCashFlow" name="Op Cash Flow" stroke={chartBlue} fillOpacity={1} fill="url(#colorOp)" stackId="1" />
                  <Area type="monotone" dataKey="freeCashFlow" name="Free Cash Flow" stroke={chartGreen} fillOpacity={1} fill="url(#colorFcf)" stackId="1" />
                  </AreaChart>
                )}
              </RechartsSizedContainer>
            </div>
          </div>
        )}

        {data.shareholdingPattern && (data.shareholdingPattern.promoters > 0 || data.shareholdingPattern.institutions > 0) && (() => {
          const s = data.shareholdingPattern
          const pieData = [
            { name: 'Insiders', value: s.promoters },
            { name: 'Institutions', value: s.institutions },
            { name: 'Public', value: s.public }
          ].filter(d => d.value > 0)

          return (
            <div className={`chart-card${isShareInView ? ' is-animated' : ''}`} ref={shareRef}>
              <h3>Shareholding Pattern</h3>
              <div className="recharts-wrapper">
                <RechartsSizedContainer height={250}>
                  {({ width, height }) => (
                    <PieChart width={width} height={height}>
                      <Pie
                        data={pieData}
                        cx={width / 2}
                        cy={height / 2}
                        innerRadius={Math.min(width, height) * 0.24}
                        outerRadius={Math.min(width, height) * 0.32}
                        paddingAngle={5}
                        dataKey="value"
                        stroke="none"
                      >
                        {pieData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      <RechartsTooltip formatter={(val: any) => `${(val * 100).toFixed(1)}%`} />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                    </PieChart>
                  )}
                </RechartsSizedContainer>
              </div>
            </div>
          )
        })()}

        {marginsTrendData.length > 0 && (
          <div className={`chart-card${isMarginInView ? ' is-animated' : ''}`} ref={marginRef}>
            <h3>Margins History</h3>
            <div className="recharts-wrapper">
              <RechartsSizedContainer height={250}>
                {({ width, height }) => (
                  <LineChart width={width} height={height} data={marginsTrendData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridStrokeColor} />
                  <XAxis dataKey="year" tick={{ fill: axisTickColor, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(val) => `${(val * 100).toFixed(0)}%`} tick={{ fill: axisTickColor, fontSize: 12 }} axisLine={false} tickLine={false} width={45} />
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <RechartsTooltip formatter={(val: any) => `${(val * 100).toFixed(2)}%`} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                  <Line type="monotone" dataKey="operatingMargin" name="Operating Margin" stroke={chartBlue} strokeWidth={3} dot={{ strokeWidth: 2, r: 4 }} activeDot={{ r: 6 }} />
                  <Line type="monotone" dataKey="netMargin" name="Net Margin" stroke={chartGreen} strokeWidth={3} dot={{ strokeWidth: 2, r: 4 }} activeDot={{ r: 6 }} />
                  </LineChart>
                )}
              </RechartsSizedContainer>
            </div>
          </div>
        )}
      </div>
    </article>
  )
}

type ChartType = 'candle' | 'line' | 'area' | 'bar'
type InsightTone = 'bullish' | 'bearish' | 'neutral'
type PriceLadderKind = 'resistance' | 'current' | 'support'

const CHART_TYPE_OPTIONS: Array<{ value: ChartType; label: string }> = [
  { value: 'candle', label: 'Candlestick' },
  { value: 'bar', label: 'Bar' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
]

const CHART_DURATION_OPTIONS = ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'ALL']

function ChartTypeSelect({
  value,
  onChange,
}: {
  value: ChartType
  onChange: (val: ChartType) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectedOption = CHART_TYPE_OPTIONS.find((opt) => opt.value === value)

  return (
    <div className="custom-chart-select" ref={containerRef}>
      <button
        type="button"
        className={`custom-select-trigger ${isOpen ? 'is-open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span>{selectedOption?.label}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="chevron-icon"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {isOpen && (
        <div className="custom-select-menu" role="listbox">
          {CHART_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`custom-select-option ${opt.value === value ? 'is-selected' : ''}`}
              role="option"
              aria-selected={opt.value === value}
              onClick={() => {
                onChange(opt.value)
                setIsOpen(false)
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type TechnicalSectionProps = {
  result: AnalysisResponse['technical']
  llmSummary?: string
  ticker: string
  beta: number | null
  displayCurrency: string
  theme?: 'light' | 'dark'
}

function TechnicalSection({
  result,
  llmSummary,
  ticker,
  beta,
  displayCurrency,
  theme,
}: TechnicalSectionProps) {
  if (!result) {
    return (
      <UnavailablePanel title="Technical Analysis">
        Technical price history is currently unavailable for this ticker.
      </UnavailablePanel>
    )
  }

  const data = resolveTechnicalData(result)
  const technicalCurrency = normalizeCurrencyCode(
    data.currency ?? result.currency ?? displayCurrency,
  )
  const trendText =
    llmSummary?.trim() || describeTechnicalSignal(result) || describeTrend(data)
  const technicalBullets = extractBulletPoints(trendText)
  const indicators = result.indicators
  const structure = result.structure
  const sma200 = isFiniteNumber(indicators?.SMA200) ? indicators.SMA200 : null
  const trendBias = resolveTrendBias(result.trend, result.signal)
  const rsiWidget = resolveRsiInsightWidget(
    typeof data.rsi === 'number' ? data.rsi : indicators?.RSI,
  )
  const macdWidget = resolveMacdInsightWidget(
    indicators?.MACD,
    indicators?.MACD_signal,
  )
  const adxWidget = resolveAdxInsightWidget(indicators?.ADX, trendBias)
  const momentumWidget = resolveMomentumInsightWidget({
    trend: result.trend,
    signal: result.signal,
    score: result.score,
    close: data.lastClose,
    sma20: data.sma20,
    sma50: data.sma50,
    rsi: rsiWidget.numericValue,
    macdTone: macdWidget.tone,
  })
  const currentPrice = isFiniteNumber(data.lastClose)
    ? data.lastClose
    : isFiniteNumber(indicators?.close)
      ? indicators.close
      : null
  const priceLadderRows = buildPriceLadderRows({
    currentPrice,
    supports: structure?.support,
    resistances: structure?.resistance,
  })
  const movingAverageAlignment = resolveMovingAverageAlignment({
    price: currentPrice,
    sma20: data.sma20,
    sma50: data.sma50,
    sma200,
  })
  const volumeSnapshot = buildVolumeSnapshot(data.ohlcv)
  const [nearestSupport] = pickSupportLevels(
    uniqueSortedLevels(structure?.support),
    currentPrice,
  )
  const [nearestResistance] = pickResistanceLevels(
    uniqueSortedLevels(structure?.resistance),
    currentPrice,
  )
  const riskMetrics = buildRiskMetrics({
    recentCloses: volumeSnapshot.recentCloses,
    beta,
    currentPrice,
    nearestSupport,
    nearestResistance,
  })
  const volatilityMetric =
    riskMetrics.find((metric) => metric.label === 'Volatility (30 day)') ?? null
  const indicatorMiniCharts = buildIndicatorMiniCharts(data.ohlcv)
  const priceRangeMarkers = buildPriceRangeMarkers(priceLadderRows)
  const currentPriceMarker =
    priceRangeMarkers.find((marker) => marker.key === 'current-price') ?? null
  const support1Marker =
    priceRangeMarkers.find((marker) => marker.key === 'support-1') ?? null
  const resistance1Marker =
    priceRangeMarkers.find((marker) => marker.key === 'resistance-1') ?? null
  const supportDistanceBand = buildPriceRangeBand(
    support1Marker?.position,
    currentPriceMarker?.position,
  )
  const resistanceDistanceBand = buildPriceRangeBand(
    currentPriceMarker?.position,
    resistance1Marker?.position,
  )
  const priceMarkerAnimationKey = priceRangeMarkers
    .map((marker) => `${marker.key}:${marker.position.toFixed(2)}:${marker.value.toFixed(2)}`)
    .join('|')
  const volatilityValue = volatilityMetric?.value ?? 'N/A'
  const volatilityNumericValue = parseMetricNumber(volatilityValue)
  const sma20Position = resolveAveragePositionStatus(data.sma20, currentPrice)
  const sma50Position = resolveAveragePositionStatus(data.sma50, currentPrice)
  const sma200Position = resolveAveragePositionStatus(sma200, currentPrice)
  const low52 = data['52WeekLow']
  const high52 = data['52WeekHigh']
  const has52WeekRange =
    isFiniteNumber(low52) &&
    isFiniteNumber(high52) &&
    high52 > low52 &&
    isFiniteNumber(currentPrice)
  const yearRangePercent = has52WeekRange
    ? clampPercent(((currentPrice - low52) / (high52 - low52)) * 100)
    : 50
  const yearRangeTone: InsightTone = !has52WeekRange
    ? 'neutral'
    : yearRangePercent >= 65
      ? 'bullish'
      : yearRangePercent <= 35
        ? 'bearish'
        : 'neutral'
  const yearRangeStatus = !has52WeekRange
    ? 'Not available'
    : yearRangePercent >= 80
      ? 'Near 52W high'
      : yearRangePercent <= 20
        ? 'Near 52W low'
        : 'Within range'
  const yearRangeValue = has52WeekRange ? `${yearRangePercent.toFixed(1)}%` : 'N/A'

  const snapshotTiles: TechnicalSnapshotRow[] = [
    {
      key: 'trend',
      metric: 'Trend',
      value: safeText(result.trend),
      status: toneToLabel(trendBias),
      tone: trendBias,
      progressPercent: isFiniteNumber(result.score)
        ? clampPercent(result.score)
        : toneToPercent(trendBias),
    },
    {
      key: 'range52',
      metric: '52W Range Position',
      value: yearRangeValue,
      status: yearRangeStatus,
      tone: yearRangeTone,
      progressPercent: yearRangePercent,
      numeric: has52WeekRange
        ? { value: yearRangePercent, format: 'percent', decimals: 1 }
        : undefined,
    },
    {
      key: 'momentum',
      metric: 'Momentum',
      value: momentumWidget.valueText,
      status: momentumWidget.signalLabel,
      tone: momentumWidget.tone,
      progressPercent: momentumWidget.percent,
      numeric: { value: momentumWidget.percent, format: 'number', decimals: 1 },
    },
    {
      key: 'volatility',
      metric: 'Volatility',
      value: volatilityValue,
      status: volatilityMetric ? riskLevelLabel(volatilityMetric.level) : 'Not available',
      tone: volatilityMetric ? riskLevelToTone(volatilityMetric.level) : 'neutral',
      progressPercent: isFiniteNumber(volatilityNumericValue)
        ? clampPercent((volatilityNumericValue / 60) * 100)
        : 50,
      numeric: isFiniteNumber(volatilityNumericValue)
        ? { value: volatilityNumericValue, format: 'percent', decimals: 1 }
        : undefined,
    },
    {
      key: 'adx',
      metric: 'ADX',
      value: adxWidget.valueText,
      status: adxWidget.contextLabel,
      tone: adxWidget.tone,
      progressPercent: adxWidget.percent,
      numeric: isFiniteNumber(adxWidget.numericValue)
        ? { value: adxWidget.numericValue, format: 'number', decimals: 1 }
        : undefined,
    },
    {
      key: 'rsi',
      metric: 'RSI (14)',
      value: rsiWidget.valueText,
      status: resolveRsiStatusLabel(rsiWidget.contextLabel),
      tone: rsiWidget.tone,
      progressPercent: rsiWidget.percent,
      numeric: isFiniteNumber(rsiWidget.numericValue)
        ? { value: rsiWidget.numericValue, format: 'number', decimals: 1 }
        : undefined,
    },
    {
      key: 'macd',
      metric: 'MACD Signal',
      value: toneToLabel(macdWidget.tone),
      status: toneArrow(macdWidget.tone),
      tone: macdWidget.tone,
      progressPercent: macdWidget.percent,
    },
    {
      key: 'sma20',
      metric: '20 Day SMA',
      value: formatCurrency(data.sma20, technicalCurrency),
      status: sma20Position.label,
      tone: sma20Position.tone,
      progressPercent: resolveMovingAverageProgress(data.sma20, currentPrice),
      numeric: isFiniteNumber(data.sma20)
        ? { value: data.sma20, format: 'currency', decimals: 2, currency: technicalCurrency }
        : undefined,
    },
    {
      key: 'sma50',
      metric: '50 Day SMA',
      value: formatCurrency(data.sma50, technicalCurrency),
      status: sma50Position.label,
      tone: sma50Position.tone,
      progressPercent: resolveMovingAverageProgress(data.sma50, currentPrice),
      numeric: isFiniteNumber(data.sma50)
        ? { value: data.sma50, format: 'currency', decimals: 2, currency: technicalCurrency }
        : undefined,
    },
    {
      key: 'sma200',
      metric: '200 Day SMA',
      value: formatCurrency(sma200, technicalCurrency),
      status: sma200Position.label,
      tone: sma200Position.tone,
      progressPercent: resolveMovingAverageProgress(sma200, currentPrice),
      numeric: isFiniteNumber(sma200)
        ? { value: sma200, format: 'currency', decimals: 2, currency: technicalCurrency }
        : undefined,
    },
  ]

  const tradingViewSymbol = toTradingViewSymbol(data.symbol)
  const chartContainerRef = useRef<HTMLDivElement | null>(null)
  const chartShellRef = useRef<HTMLDivElement | null>(null)
  const snapshotSectionRef = useRef<HTMLElement | null>(null)
  const priceLevelsRef = useRef<HTMLElement | null>(null)
  const indicatorTrendsRef = useRef<HTMLElement | null>(null)
  const [chartType, setChartType] = useState<ChartType>('candle')
  const [chartDuration, setChartDuration] = useState<string>('1M')
  const [chartData, setChartData] = useState<any[]>([])
  const [chartCurrency, setChartCurrency] = useState<string | null>(null)
  const [isChartLoading, setIsChartLoading] = useState(false)
  const [chartFetchError, setChartFetchError] = useState('')
  const [isChartReady, setIsChartReady] = useState(false)
  const [showPriceRangeMarkers, setShowPriceRangeMarkers] = useState(false)
  const isChartInView = useInViewOnce(chartShellRef, { threshold: 0.1 })
  const isSnapshotInView = useInViewOnce(snapshotSectionRef, { threshold: 0.05 })
  const isPriceLevelsInView = useInViewOnce(priceLevelsRef, { threshold: 0.05 })
  const isIndicatorTrendsInView = useInViewOnce(indicatorTrendsRef, { threshold: 0.05 })
  const activeChartRows = useMemo(
    () => (chartData.length > 0 ? chartData : (data.ohlcv ?? [])),
    [chartData, data.ohlcv],
  )
  const chartPerformance = useMemo(() => {
    const closes = activeChartRows
      .map((point) => point?.close)
      .filter((value): value is number => isFiniteNumber(value))
    if (closes.length < 2 || closes[0] === 0) {
      return null
    }
    const start = closes[0]
    const end = closes[closes.length - 1]
    const change = end - start
    return {
      start,
      end,
      change,
      percent: (change / start) * 100,
    }
  }, [activeChartRows])
  const chartDirectionTone: InsightTone =
    chartPerformance && chartPerformance.change > 0
      ? 'bullish'
      : chartPerformance && chartPerformance.change < 0
        ? 'bearish'
        : 'neutral'
  const chartDirectionLabel =
    chartPerformance && chartPerformance.change > 0
      ? 'Uptrend'
      : chartPerformance && chartPerformance.change < 0
        ? 'Downtrend'
        : 'Sideways'
  const livePrice = useMemo(() => {
    const latest = activeChartRows[activeChartRows.length - 1]?.close
    if (isFiniteNumber(latest)) {
      return latest
    }
    return isFiniteNumber(currentPrice) ? currentPrice : null
  }, [activeChartRows, currentPrice])
  const activeCurrency = chartCurrency ?? technicalCurrency
  const technicalScoreTone = scoreToTone(result.score)
  const technicalScorePercent = isFiniteNumber(result.score)
    ? clampPercent(result.score)
    : 50
  const technicalScoreZone = isFiniteNumber(result.score)
    ? result.score < 30
      ? 'strong-bearish'
      : result.score < 45
        ? 'bearish'
        : result.score < 55
          ? 'neutral'
          : result.score < 70
            ? 'bullish'
            : 'strong-bullish'
    : 'neutral'
  const technicalSignalLabel =
    result.signal === 'Strong Bullish'
      ? 'Strongly Bullish'
      : result.signal === 'Strong Bearish'
        ? 'Strongly Bearish'
        : safeText(result.signal)

  useEffect(() => {
    setShowPriceRangeMarkers(false)
    if (!isPriceLevelsInView || priceRangeMarkers.length === 0) {
      return
    }

    const frame = requestAnimationFrame(() => {
      setShowPriceRangeMarkers(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [isPriceLevelsInView, priceMarkerAnimationKey])

  // Fetch fine-grained chart data when duration changes
  useEffect(() => {
    let cancelled = false
    setIsChartLoading(true)
    setChartFetchError('')
    setChartCurrency(null)

    import('./api')
      .then(({ fetchChartData }) => fetchChartData(ticker, chartDuration))
      .then((payload) => {
        if (!cancelled) {
          setChartData(payload.ohlcv || [])
          setChartCurrency(
            payload.currency ? normalizeCurrencyCode(payload.currency) : null,
          )
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : 'Failed to load chart data.'
          setChartFetchError(message)
          setChartData([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsChartLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [ticker, chartDuration])

  useEffect(() => {
    let cancelled = false
    const container = chartContainerRef.current
    if (!container) return

    setIsChartReady(false)
    let chart: any | null = null
    let resizeObserver: ResizeObserver | null = null

    const initChart = async () => {
      // Lazy-load lightweight-charts from a CDN the first time it is needed.
      let lib = (window as any).LightweightCharts
      if (!lib) {
        const script = document.createElement('script')
        script.src =
          'https://unpkg.com/lightweight-charts@4.2.1/dist/lightweight-charts.standalone.production.js'
        script.async = true

        await new Promise<void>((resolve, reject) => {
          script.onload = () => resolve()
          script.onerror = () => reject(new Error('Failed to load chart library'))
          document.head.appendChild(script)
        })

        lib = (window as any).LightweightCharts
        if (!lib) return
      }

      if (cancelled) return

      const { width, height } = container.getBoundingClientRect()
      chart = lib.createChart(container, {
        width,
        height,
        layout: {
          background: { color: theme === 'dark' ? 'transparent' : 'white' },
          textColor: theme === 'dark' ? '#f8fafc' : '#111827',
        },
        rightPriceScale: {
          visible: true,
        },
        timeScale: {
          borderColor: theme === 'dark' ? '#334155' : '#e5e7eb',
          timeVisible: true,
        },
        grid: {
          vertLines: { color: theme === 'dark' ? '#1e293b' : '#f3f4f6' },
          horzLines: { color: theme === 'dark' ? '#1e293b' : '#f3f4f6' },
        },
        localization: {
          locale: 'en-US',
          priceFormatter: (price: number) => formatCurrency(price, activeCurrency),
        },
        handleScroll: false,
        handleScale: false,
      })

      const ohlcv = activeChartRows
      let candles = ohlcv
        .map((bar) => {
          const t = bar.date
          const dt = typeof t === 'string' ? new Date(t) : new Date(t * 1000)
          if (Number.isNaN(dt.getTime())) {
            return null
          }
          let ts = dt.getTime() / 1000

          // Lightweight charts requires strictly increasing timestamps. 
          // For intraday, we must pass it as a unix timestamp. For daily, we can use strings but timestamp is safer.
          // Note for intraday data we must ensure times match the local timezone of the exchange, but standard unix timestamp works best if auto-scaling.
          return {
            time: ts as any,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
          }
        })
        .filter(Boolean) as Array<{
          time: any
          open: number
          high: number
          low: number
          close: number
        }>

      // Sort candles by time just in case to avoid LightweightCharts errors
      candles.sort((a, b) => a.time - b.time)

      // Deduplicate by time to avoid LightweightCharts errors
      const uniqueCandles: typeof candles = []
      const seenTimes = new Set()
      for (const candle of candles) {
        if (!seenTimes.has(candle.time)) {
          seenTimes.add(candle.time)
          uniqueCandles.push(candle)
        }
      }
      candles = uniqueCandles

      const lineData = candles.map((c) => ({ time: c.time, value: c.close }))

      let series: any
      if (chartType === 'candle') {
        series = chart.addCandlestickSeries()
        series.setData(candles)
      } else if (chartType === 'bar') {
        series = chart.addBarSeries()
        series.setData(candles)
      } else if (chartType === 'area') {
        series = chart.addAreaSeries({
          lineColor: '#2962ff',
          topColor: 'rgba(41, 98, 255, 0.4)',
          bottomColor: 'rgba(41, 98, 255, 0.0)',
        })
        series.setData(lineData)
      } else {
        series = chart.addLineSeries({ color: '#2962ff' })
        series.setData(lineData)
      }

      chart.timeScale().fitContent()
      if (!cancelled) {
        setIsChartReady(true)
      }

      if (cancelled) {
        if (chart) chart.remove()
        return
      }

      const resize = () => {
        if (!container || !chart) return
        const { width: w, height: h } = container.getBoundingClientRect()
        chart.applyOptions({ width: w, height: h })
      }
      resize()
      resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(container)
    }

    initChart().catch(() => {
      // Fail silently; layout still renders without the chart.
      if (!cancelled) {
        setIsChartReady(true)
      }
    })

    return () => {
      cancelled = true
      if (resizeObserver && container) {
        resizeObserver.unobserve(container)
      }
      if (chart) {
        chart.remove()
      }
    }
  }, [activeChartRows, tradingViewSymbol, chartType, chartDuration, activeCurrency, theme])

  return (
    <article className={`panel reveal theme-${theme}`}>
      <header className="panel-head">
        <h2>Technical Analysis</h2>
        <span className="score-tag">{formatScore(result.score)}</span>
      </header>
      {technicalBullets.length > 0 ? (
        <ul className="analysis-bullets">
          {technicalBullets.map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="analysis-copy">{trendText}</p>
      )}
      <div className="technical-layout">
        <div className="chart-block">
          <div className="chart-surface-head">
            <div className="chart-context">
              <div className="chart-context-main">
                <div className="chart-symbol-price">
                  <h3>{ticker?.toUpperCase() ?? ''}</h3>
                  <span className="chart-live-price">
                    <span className="chart-live-dot" aria-hidden="true" />
                    {livePrice !== null ? formatCurrency(livePrice, activeCurrency) : 'N/A'}
                  </span>
                </div>
                <span className={`chart-delta tone-${chartDirectionTone}`}>
                  {chartPerformance
                    ? `${chartPerformance.change >= 0 ? '+' : ''}${chartPerformance.percent.toFixed(2)}%`
                    : 'N/A'}
                </span>
              </div>
              <p className="chart-context-meta">
                {chartPerformance
                  ? `${chartDirectionLabel} in ${chartDuration}: ${formatCurrency(chartPerformance.start, activeCurrency)} -> ${formatCurrency(chartPerformance.end, activeCurrency)}`
                  : 'Switch duration and chart style to inspect movement.'}
              </p>
            </div>
            <div className="chart-controls" aria-label="Chart controls">
              <div className="chart-type-selector">
                {CHART_DURATION_OPTIONS.map((dur) => (
                  <button
                    key={dur}
                    type="button"
                    className={chartDuration === dur ? 'active' : ''}
                    onClick={() => setChartDuration(dur)}
                  >
                    {dur}
                  </button>
                ))}
              </div>
              <ChartTypeSelect value={chartType} onChange={setChartType} />
            </div>

          </div>
          <div
            ref={chartShellRef}
            className={`tv-chart-shell${isChartLoading ? ' is-loading' : ''}${isChartReady ? ' is-ready' : ''}${chartFetchError ? ' has-error' : ''}${isChartInView ? ' is-armed' : ''}`}
          >
            <div
              key={`${chartType}-${chartDuration}`}
              className="tv-chart-wrap"
              ref={chartContainerRef}
            />
            {isChartLoading && (
              <div className="chart-overlay" role="status" aria-live="polite">
                <span className="chart-loader-line" />
                <p>Refreshing chart...</p>
              </div>
            )}
            {!isChartLoading && chartFetchError && (
              <div className="chart-overlay chart-overlay-error" role="status">
                <p>{chartFetchError}</p>
              </div>
            )}
            {!isChartLoading && !chartFetchError && activeChartRows.length === 0 && (
              <div className="chart-overlay" role="status">
                <p>No chart data available for this range.</p>
              </div>
            )}
          </div>
        </div>
        <aside className="technical-side-column">
          <section className={`technical-score-card tone-${technicalScoreTone}`}>
            <h3>Technical Score</h3>
            <div className={`technical-score-meter-wrap zone-${technicalScoreZone}`}>
              <div className="technical-score-meter-head">
                <span className="technical-score-signal">{technicalSignalLabel}</span>
                <strong className="technical-score-value">{formatScore(result.score)}</strong>
              </div>
              <div className="technical-score-meter-visual" aria-hidden="true">
                <div className="technical-score-meter-track">
                  <div className="technical-score-meter-segments">
                    <span className="segment strong-bearish" />
                    <span className="segment bearish" />
                    <span className="segment neutral" />
                    <span className="segment bullish" />
                    <span className="segment strong-bullish" />
                  </div>
                  <span
                    className="technical-score-meter-marker"
                    style={{ left: `${technicalScorePercent}%` }}
                  />
                </div>
                <div className="technical-score-meter-scale">
                  {[0, 25, 50, 75, 100].map((tick) => (
                    <span
                      key={`score-tick-${tick}`}
                      className={`technical-score-meter-tick${tick === 0 ? ' edge-start' : ''}${tick === 100 ? ' edge-end' : ''}`}
                      style={{ left: `${tick}%` }}
                    >
                      <span className="technical-score-meter-tick-mark" />
                      <span className="technical-score-meter-tick-label">{tick}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>
          <section className="technical-data-card">
            <h3>Data used</h3>
            <MetricList
              rows={[
                ['Trend Direction', safeText(result.trend)],
                ['RSI (14)', formatNumber(data.rsi)],
                ['MACD Signal', formatNumber(indicators?.MACD_signal)],
                ['ADX (Trend Strength)', formatNumber(indicators?.ADX)],
                ['20D Moving Average', formatCurrency(data.sma20, technicalCurrency)],
                ['50D Moving Average', formatCurrency(data.sma50, technicalCurrency)],
                ['200D Moving Average', formatCurrency(indicators?.SMA200, technicalCurrency)],
                ['Support Level', formatPrimaryLevel(structure?.support, technicalCurrency)],
                ['Resistance Level', formatPrimaryLevel(structure?.resistance, technicalCurrency)],
              ]}
            />
          </section>
        </aside>
      </div>
      <section
        ref={snapshotSectionRef}
        className="technical-snapshot-section"
        aria-label="Technical snapshot"
      >
        <div className="technical-snapshot-panels">
          <article className="snapshot-panel">
            <header className="snapshot-panel-head">
              <h4>Technical Snapshot</h4>
              <span className={`snapshot-badge tone-${movingAverageAlignment.tone}`}>
                {movingAverageAlignment.label}
              </span>
            </header>
            <div className="snapshot-tiles-grid">
              {snapshotTiles.map((tile, index) => (
                <SnapshotMetricTile
                  key={tile.key}
                  tile={tile}
                  index={index}
                  isAnimated={isSnapshotInView}
                />
              ))}
            </div>
          </article>

          <article className="snapshot-panel" ref={priceLevelsRef}>
            <header className="snapshot-panel-head">
              <h4>Price Levels</h4>
            </header>
            <div className="price-range-wrap" aria-label="Support and resistance range">
              <div className="price-range-track">
                <span className="price-range-line" />
                {supportDistanceBand && (
                  <span
                    className="price-range-distance support"
                    style={{
                      left: `${supportDistanceBand.left}%`,
                      width: `${supportDistanceBand.width}%`,
                    }}
                  />
                )}
                {resistanceDistanceBand && (
                  <span
                    className="price-range-distance resistance"
                    style={{
                      left: `${resistanceDistanceBand.left}%`,
                      width: `${resistanceDistanceBand.width}%`,
                    }}
                  />
                )}
                {priceRangeMarkers.map((marker, index) => (
                  <div
                    key={marker.key}
                    className={`price-range-marker kind-${marker.kind} anchor-${marker.anchor} ${index % 2 === 0 ? 'above' : 'below'}${showPriceRangeMarkers ? ' is-animated' : ''}`}
                    style={{
                      left: showPriceRangeMarkers ? `${marker.position}%` : '50%',
                      opacity: showPriceRangeMarkers ? 1 : 0,
                      transitionDelay: `${index * 70}ms`,
                    }}
                    tabIndex={0}
                  >
                    <span className="price-range-marker-dot" />
                    <div className="price-range-tooltip" role="tooltip">
                      <p className="price-range-tooltip-label">{marker.label}</p>
                      <p className="price-range-tooltip-value">
                        {formatCurrency(marker.value, technicalCurrency)}
                      </p>
                      <p className="price-range-tooltip-distance">
                        {resolvePriceMarkerTooltipDistance(marker)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="price-range-cards">
                {priceLadderRows.map((row, index) => (
                  <article
                    key={row.key}
                    className={`price-range-card kind-${row.kind}${isPriceLevelsInView ? ' is-animated' : ''}`}
                    style={isPriceLevelsInView ? { animationDelay: `${index * 30 + 50}ms` } : undefined}
                  >
                    <div className="price-range-card-head">
                      <span>{row.label}</span>
                      <strong>{formatCurrency(row.value, technicalCurrency)}</strong>
                    </div>
                    <p>{row.distanceLabel || 'N/A'}</p>
                  </article>
                ))}
              </div>
            </div>
          </article>

          <article className="snapshot-panel" ref={indicatorTrendsRef}>
            <header className="snapshot-panel-head">
              <h4>Indicator Trends</h4>
            </header>
            <div className="indicator-dashboard-grid">
              {indicatorMiniCharts.map((chart, index) => (
                <article
                  key={chart.key}
                  className={`indicator-mini-chart${isIndicatorTrendsInView ? ' is-animated' : ''}`}
                  style={isIndicatorTrendsInView ? { animationDelay: `${index * 30 + 50}ms` } : undefined}
                >
                  <header className="indicator-mini-head">
                    <h5>{chart.title}</h5>
                    <strong>{chart.currentValueLabel}</strong>
                  </header>
                  <div className="indicator-mini-body">
                    {chart.series.length > 0 ? (
                      <IndicatorMiniSparkline chart={chart} isAnimated={isIndicatorTrendsInView} />
                    ) : (
                      <div className="indicator-mini-empty">No data</div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </article>
        </div>
      </section>
    </article>
  )
}

type SentimentSectionProps = {
  result: AnalysisResponse['sentiment']
  llmSummary?: string
  theme?: 'light' | 'dark'
}

function SentimentSection({ result, llmSummary, theme }: SentimentSectionProps) {
  const HEADLINES_BATCH_SIZE = 15
  const [headlineQuery, setHeadlineQuery] = useState('')
  const [headlineToneFilter, setHeadlineToneFilter] = useState<
    'all' | 'positive' | 'neutral' | 'negative'
  >('all')
  const [visibleHeadlineCount, setVisibleHeadlineCount] = useState(HEADLINES_BATCH_SIZE)

  if (!result) {
    return (
      <UnavailablePanel title="Sentiment Analysis">
        News sentiment is currently unavailable for this ticker.
      </UnavailablePanel>
    )
  }

  const headlines: SentimentHeadline[] = result.headlines
  const summary = llmSummary?.trim() || summarizeScore(result.score, 'sentiment')
  const sentimentSummary = parseSentimentSummary(summary)
  const sentimentScorePercent = isFiniteNumber(result.score)
    ? clampPercent(result.score)
    : 50
  const sentimentScoreZone = isFiniteNumber(result.score)
    ? result.score < 30
      ? 'strong-bearish'
      : result.score < 45
        ? 'bearish'
        : result.score < 55
          ? 'neutral'
          : result.score < 70
            ? 'bullish'
            : 'strong-bullish'
    : 'neutral'
  const sentimentSignalLabel = isFiniteNumber(result.score)
    ? result.score < 30
      ? 'Very Negative'
      : result.score < 45
        ? 'Negative'
        : result.score < 55
          ? 'Mixed'
          : result.score < 70
            ? 'Positive'
            : 'Very Positive'
    : 'N/A'
  const sentimentCounts = headlines.reduce(
    (counts, headline) => {
      const tone = sentimentSignalTone(headline.sentiment)
      counts[tone] += 1
      return counts
    },
    {
      positive: 0,
      neutral: 0,
      negative: 0,
    } as Record<'positive' | 'neutral' | 'negative', number>,
  )
  const filteredHeadlines = useMemo(() => {
    const query = headlineQuery.trim().toLowerCase()
    return headlines.filter((headline) => {
      const tone = sentimentSignalTone(headline.sentiment)
      if (headlineToneFilter !== 'all' && tone !== headlineToneFilter) {
        return false
      }
      if (!query) {
        return true
      }
      const title = (headline.title || '').toLowerCase()
      const source = (headline.source || headline.apiSource || '').toLowerCase()
      return title.includes(query) || source.includes(query)
    })
  }, [headlineQuery, headlineToneFilter, headlines])
  const visibleHeadlines = filteredHeadlines.slice(0, visibleHeadlineCount)
  const hasMoreHeadlines = visibleHeadlineCount < filteredHeadlines.length

  return (
    <article className={`panel reveal theme-${theme}`}>
      <header className="panel-head">
        <h2>Sentiment Analysis</h2>
        <span className="score-tag">{formatScore(result.score)}</span>
      </header>
      {sentimentSummary.insights.length > 0 || sentimentSummary.summary ? (
        <div className="sentiment-summary">
          {sentimentSummary.insights.length > 0 && (
            <section className="sentiment-summary-card">
              <h3>Main Insights from news headlines</h3>
              <ul className="analysis-bullets">
                {sentimentSummary.insights.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            </section>
          )}
          {sentimentSummary.summary && (
            <section className="sentiment-summary-card">
              <h3>Summary</h3>
              <p className="analysis-copy">{sentimentSummary.summary}</p>
            </section>
          )}
        </div>
      ) : (
        <p className="analysis-copy">{summary}</p>
      )}
      <div className="sentiment-metrics-grid">
        <section className="sentiment-summary-card sentiment-overview-card">
          <div className="sentiment-overview-split">
            <dl className="sentiment-count-list sentiment-counts-panel">
              <div>
                <dt>Positive headlines</dt>
                <dd>{sentimentCounts.positive}</dd>
              </div>
              <div>
                <dt>Neutral headlines</dt>
                <dd>{sentimentCounts.neutral}</dd>
              </div>
              <div>
                <dt>Negative headlines</dt>
                <dd>{sentimentCounts.negative}</dd>
              </div>
            </dl>
            <div className="sentiment-meter-wrap">
              <h3 className="sentiment-meter-title">Sentiment Score</h3>
              <div
                className={`technical-score-meter-wrap zone-${sentimentScoreZone}`}
                aria-label={`Overall sentiment score ${formatScore(result.score)} (${sentimentSignalLabel})`}
                role="img"
              >
                <div className="technical-score-meter-head">
                  <span className="technical-score-signal">{sentimentSignalLabel}</span>
                  <strong className="technical-score-value">{formatScore(result.score)}</strong>
                </div>
                <div className="technical-score-meter-visual" aria-hidden="true">
                  <div className="technical-score-meter-track">
                    <div className="technical-score-meter-segments">
                      <span className="segment strong-bearish" />
                      <span className="segment bearish" />
                      <span className="segment neutral" />
                      <span className="segment bullish" />
                      <span className="segment strong-bullish" />
                    </div>
                    <span
                      className="technical-score-meter-marker"
                      style={{ left: `${sentimentScorePercent}%` }}
                    />
                  </div>
                  <div className="technical-score-meter-scale">
                    {[0, 25, 50, 75, 100].map((tick) => (
                      <span
                        key={`sentiment-tick-${tick}`}
                        className={`technical-score-meter-tick${tick === 0 ? ' edge-start' : ''}${tick === 100 ? ' edge-end' : ''}`}
                        style={{ left: `${tick}%` }}
                      >
                        <span className="technical-score-meter-tick-mark" />
                        <span className="technical-score-meter-tick-label">{tick}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="headline-filters">
        <input
          className="headline-search-input"
          value={headlineQuery}
          onChange={(event) => {
            setHeadlineQuery(event.target.value)
            setVisibleHeadlineCount(HEADLINES_BATCH_SIZE)
          }}
          placeholder="Search headlines or source"
          aria-label="Search headlines"
        />
        <div className="headline-tone-filter" role="group" aria-label="Filter headlines">
          {[
            { key: 'all', label: 'All' },
            { key: 'positive', label: 'Positive' },
            { key: 'neutral', label: 'Neutral' },
            { key: 'negative', label: 'Negative' },
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              className={headlineToneFilter === option.key ? 'active' : ''}
              onClick={() => {
                setHeadlineToneFilter(
                  option.key as 'all' | 'positive' | 'neutral' | 'negative',
                )
                setVisibleHeadlineCount(HEADLINES_BATCH_SIZE)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="headline-filter-count">
          Showing {Math.min(visibleHeadlines.length, filteredHeadlines.length)} of{' '}
          {filteredHeadlines.length} filtered headlines
        </p>
      </div>

      <div className="headline-list">
        {headlines.length === 0 && <p>No headlines returned from the news sources.</p>}
        {headlines.length > 0 && filteredHeadlines.length === 0 && (
          <p>No headlines match the current filters.</p>
        )}
        {visibleHeadlines.map((headline, index) => {
          const signalTone = sentimentSignalTone(headline.sentiment)
          const sentimentLabel = formatHeadlineSentimentLabel(headline.sentiment)
          const confidenceLabel = formatHeadlineConfidence(headline.sentimentScore)
          return (
            <article className="headline-item" key={`${headline.title}-${index}`}>
              <div className="headline-row">
                {headline.link ? (
                  <a href={headline.link} target="_blank" rel="noreferrer">
                    {headline.title}
                  </a>
                ) : (
                  <p>{headline.title}</p>
                )}
                <div className="headline-meta">
                  <span
                    className={`headline-signal tone-${signalTone}`}
                    aria-label={`${sentimentLabel} sentiment, confidence ${confidenceLabel}`}
                    title={`${sentimentLabel} sentiment, confidence ${confidenceLabel}`}
                  >
                    <span className="headline-signal-label">{sentimentLabel}</span>
                    <span className="headline-signal-confidence">{confidenceLabel}</span>
                  </span>
                  <span className="headline-time">
                    {formatHeadlineTimestamp(resolveHeadlineTimestamp(headline))}
                  </span>
                </div>
              </div>
            </article>
          )
        })}
        {hasMoreHeadlines && (
          <div className="headline-actions">
            <button
              type="button"
              className="headline-show-more"
              onClick={() =>
                setVisibleHeadlineCount((count) => count + HEADLINES_BATCH_SIZE)
              }
            >
              Show more
            </button>
          </div>
        )}
      </div>
    </article>
  )
}

function SnapshotMetricTile({
  tile,
  index,
  isAnimated,
}: {
  tile: TechnicalSnapshotRow
  index: number
  isAnimated: boolean
}) {
  const animatedValue = useAnimatedNumber(tile.numeric?.value ?? null, 1200, isAnimated)
  const animatedProgress = useAnimatedNumber(tile.progressPercent, 1200, isAnimated)
  const valueLabel =
    tile.numeric && isFiniteNumber(animatedValue)
      ? formatAnimatedSnapshotValue(animatedValue, tile.numeric)
      : tile.value

  return (
    <article
      className={`snapshot-tile tone-${tile.tone}${isAnimated ? ' is-animated' : ''}`}
      style={isAnimated ? { animationDelay: `${index * 30}ms` } : undefined}
    >
      <p className="snapshot-tile-label">{tile.metric}</p>
      <div className="snapshot-tile-value-row">
        <p className="snapshot-tile-value">{valueLabel}</p>
        <span
          className={`snapshot-value-dot tone-${tile.tone}`}
          aria-hidden="true"
        />
      </div>
      <div
        className={`snapshot-tile-meter tone-${tile.tone}`}
        role="presentation"
        aria-hidden="true"
      >
        <span style={{ width: `${clampPercent(animatedProgress ?? 0)}%` }} />
      </div>
      <p className={`snapshot-tile-status tone-${tile.tone}`}>{tile.status}</p>
    </article>
  )
}

function resolveCssColorValue(value: string, fallback: string): string {
  const raw = value.trim()
  if (!raw) {
    return fallback
  }
  if (!raw.startsWith('var(')) {
    return raw
  }
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return fallback
  }

  const match = raw.match(/^var\((--[^,\s)]+)(?:,\s*([^)]+))?\)$/)
  if (!match) {
    return fallback
  }

  const cssVarName = match[1]
  const fallbackFromVar = match[2]?.trim()
  const resolved = getComputedStyle(document.documentElement)
    .getPropertyValue(cssVarName)
    .trim()

  if (resolved) {
    return resolved
  }
  if (fallbackFromVar) {
    return fallbackFromVar
  }
  return fallback
}

function toFiniteOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function IndicatorMiniSparkline({
  chart,
  isAnimated,
}: {
  chart: IndicatorMiniChart
  isAnimated: boolean
}) {
  const gradientId = `indicator-mini-gradient-${chart.key}`
  const resolvedStroke = resolveCssColorValue(chart.stroke, '#2563eb')
  const series = chart.series.filter((point) => isFiniteNumber(point.value))
  if (series.length === 0) {
    return <div className="indicator-mini-empty">No data</div>
  }

  const width = 320
  const height = 96
  const inset = 8
  const baselineY = height - inset
  const minValue = Math.min(...series.map((point) => point.value))
  const maxValue = Math.max(...series.map((point) => point.value))
  const valueRange = maxValue - minValue || 1
  const xRange = Math.max(1, series.length - 1)
  const points = series.map((point, index) => {
    const x = inset + (index / xRange) * (width - inset * 2)
    const y =
      baselineY - ((point.value - minValue) / valueRange) * (height - inset * 2)
    return { x, y }
  })

  const linePath = points
    .map((point, index) =>
      `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
    )
    .join(' ')
  const firstPoint = points[0]
  const lastPoint = points[points.length - 1]
  const areaPath = `${linePath} L ${lastPoint.x.toFixed(2)} ${baselineY.toFixed(2)} L ${firstPoint.x.toFixed(2)} ${baselineY.toFixed(2)} Z`

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-label={`${chart.title} trend chart`}
      role="img"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={resolvedStroke} stopOpacity={0.35} />
          <stop offset="100%" stopColor={resolvedStroke} stopOpacity={0.03} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={resolvedStroke}
        strokeWidth={2.1}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={
          isAnimated
            ? { opacity: 1, transformOrigin: 'center', transition: 'opacity 420ms ease' }
            : { opacity: 1 }
        }
      />
      <circle
        cx={lastPoint.x}
        cy={lastPoint.y}
        r={2.9}
        fill={resolvedStroke}
        stroke="#ffffff"
        strokeWidth={1.4}
      />
    </svg>
  )
}

function FullReportSection({
  analysis,
  isGeneratingReport,
  user,
  theme,
}: {
  analysis: AnalysisResponse
  isGeneratingReport?: boolean
  user?: import('./types').AuthUser | null
  theme?: 'light' | 'dark'
}) {
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false)
  const [pdfDownloadError, setPdfDownloadError] = useState('')

  const handleDownloadPdf = useCallback(async () => {
    if (isDownloadingPdf) {
      return
    }
    setPdfDownloadError('')
    setIsDownloadingPdf(true)
    try {
      const pdfBlob = await downloadAnalysisPdf(analysis)
      const objectUrl = window.URL.createObjectURL(pdfBlob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = `${analysis.ticker}_StockInsight_Report.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 800)
    } catch (error) {
      setPdfDownloadError(
        error instanceof Error
          ? error.message
          : 'Failed to generate PDF report.',
      )
    } finally {
      setIsDownloadingPdf(false)
    }
  }, [analysis, isDownloadingPdf])

  const reportText = normalizeInlineBulletLists(
    emphasizeSummaryLabel(analysis.report?.trim() ?? ''),
  )
  const sections = analysis.reportSections ?? {}
  const fundamentalData = analysis.fundamental?.data
  const technicalResult = analysis.technical
  const technicalData = technicalResult ? resolveTechnicalData(technicalResult) : null
  const displayCurrency = resolveAnalysisCurrency(analysis)
  const companyName =
    fundamentalData?.shortName ?? fundamentalData?.longName ?? analysis.ticker
  const sectorLabel = sanitizeReportText(fundamentalData?.sector) || 'Equities'
  const industryLabel = sanitizeReportText(fundamentalData?.industry) || 'Technology'

  const latestPrice =
    fundamentalData?.currentPrice ??
    technicalData?.lastClose ??
    technicalResult?.indicators?.close ??
    null
  const ohlcv = technicalData?.ohlcv ?? technicalResult?.ohlcv ?? []
  let previousClose: number | null = null
  if (ohlcv.length >= 2) {
    const value = ohlcv[ohlcv.length - 2]?.close
    if (isFiniteNumber(value)) {
      previousClose = value
    }
  }
  const priceChange =
    isFiniteNumber(latestPrice) && isFiniteNumber(previousClose)
      ? latestPrice - previousClose
      : null
  const priceChangePercent =
    isFiniteNumber(priceChange) &&
      isFiniteNumber(previousClose) &&
      previousClose !== 0
      ? (priceChange / previousClose) * 100
      : null
  const priceToneClass = !isFiniteNumber(priceChange)
    ? 'neutral'
    : priceChange >= 0
      ? 'positive'
      : 'negative'



  const marketCapLabel = formatCompactMoney(fundamentalData?.marketCap, displayCurrency)

  const executiveBriefing = summarizeForCard(
    sections.overall ?? reportText,
    isGeneratingReport
      ? 'Generating report summary...'
      : 'Overview summary is currently unavailable.',
    390,
  )
  const fundamentalNarrative = pickPrimaryInsight(
    sections.fundamental,
    'Fundamental analysis summary is currently unavailable.',
    210,
  )
  const technicalSummaryFallback = technicalResult
    ? describeTechnicalSignal(technicalResult)
    : ''
  const technicalNarrative = pickPrimaryInsight(
    sections.technical ?? technicalSummaryFallback,
    'Technical analysis summary is currently unavailable.',
    210,
  )
  const fundamentalSummaryPoints = buildSectionSummaryPoints(
    sections.fundamental,
    fundamentalNarrative,
  )
  const technicalSummaryPoints = buildSectionSummaryPoints(
    sections.technical ?? technicalSummaryFallback,
    technicalNarrative,
  )
  const sentimentParsed = parseSentimentSummary(sections.sentiment ?? '')
  const sentimentSummaryText = summarizeForCard(
    sentimentParsed.summary || sections.sentiment,
    isGeneratingReport
      ? 'Generating sentiment summary...'
      : 'Sentiment summary is currently unavailable.',
    310,
  )
  const sentimentSummaryPoints = buildSectionSummaryPoints(
    sentimentSummaryText,
    sentimentSummaryText,
  )
  const riskItems = buildRiskItems(sections.riskFactors ?? sections.conclusion)

  const technicalScoreValue = isFiniteNumber(technicalResult?.score)
    ? technicalResult.score
    : isFiniteNumber(analysis.overview.technicalScore)
      ? analysis.overview.technicalScore
      : null
  const technicalScorePercent = isFiniteNumber(technicalScoreValue)
    ? clampPercent(technicalScoreValue)
    : toneToPercent(resolveTrendBias(technicalResult?.trend, technicalResult?.signal))
  const technicalScoreZone = resolveScoreZone(technicalScoreValue)
  const technicalSignalLabel =
    technicalResult?.signal === 'Strong Bullish'
      ? 'Strongly Bullish'
      : technicalResult?.signal === 'Strong Bearish'
        ? 'Strongly Bearish'
        : safeText(technicalResult?.signal)
  const technicalIndicatorTone = scoreToTone(technicalScoreValue)
  const technicalScoreLabel = formatScore(technicalScoreValue)
  const fundamentalScoreValue = isFiniteNumber(analysis.fundamental?.score)
    ? analysis.fundamental.score
    : isFiniteNumber(analysis.overview.fundamentalScore)
      ? analysis.overview.fundamentalScore
      : null
  const fundamentalScorePercent = isFiniteNumber(fundamentalScoreValue)
    ? clampPercent(fundamentalScoreValue)
    : 50
  const fundamentalScoreZone = resolveScoreZone(fundamentalScoreValue)
  const fundamentalSignalLabel = resolveFundamentalSignalLabel(fundamentalScoreValue)
  const fundamentalIndicatorTone = scoreToTone(fundamentalScoreValue)
  const fundamentalScoreLabel = formatScore(fundamentalScoreValue)
  const sentimentScoreValue = isFiniteNumber(analysis.sentiment?.score)
    ? analysis.sentiment.score
    : isFiniteNumber(analysis.overview.sentimentScore)
      ? analysis.overview.sentimentScore
      : null
  const sentimentScorePercent = isFiniteNumber(sentimentScoreValue)
    ? clampPercent(sentimentScoreValue)
    : 50
  const sentimentScoreZone = resolveScoreZone(sentimentScoreValue)
  const sentimentSignalLabel = resolveSentimentSignalLabel(sentimentScoreValue)
  const sentimentIndicatorTone = scoreToTone(sentimentScoreValue)
  const sentimentScoreLabel = formatScore(sentimentScoreValue)

  const performanceMetrics = [
    { label: 'P/E Ratio (TTM)', value: formatNumber(fundamentalData?.trailingPE), highlight: false },
    { label: 'Div Yield', value: formatPercent(fundamentalData?.dividendYield), highlight: false },
    { label: 'EPS (Diluted)', value: formatCurrency(fundamentalData?.trailingEps, displayCurrency), highlight: false },
    {
      label: 'ROE',
      value: formatPercent(fundamentalData?.returnOnEquity),
      highlight: isFiniteNumber(fundamentalData?.returnOnEquity) && fundamentalData.returnOnEquity > 0,
    },
    { label: 'Beta (5Y)', value: formatNumber(fundamentalData?.beta), highlight: false },
  ]

  const revenueRows = buildRevenueTrendRows(fundamentalData?.revenueTrend)
  const fullReportIndicators = technicalResult?.indicators
  const fullReportStructure = technicalResult?.structure
  const fullReportTechnicalCurrency = normalizeCurrencyCode(
    technicalData?.currency ?? technicalResult?.currency ?? displayCurrency,
  )
  const fullReportSma200 = isFiniteNumber(fullReportIndicators?.SMA200)
    ? fullReportIndicators.SMA200
    : null
  const fullReportTrendBias = resolveTrendBias(technicalResult?.trend, technicalResult?.signal)
  const fullReportRsiWidget = resolveRsiInsightWidget(
    isFiniteNumber(technicalData?.rsi) ? technicalData.rsi : fullReportIndicators?.RSI,
  )
  const fullReportMacdWidget = resolveMacdInsightWidget(
    fullReportIndicators?.MACD,
    fullReportIndicators?.MACD_signal,
  )
  const fullReportAdxWidget = resolveAdxInsightWidget(fullReportIndicators?.ADX, fullReportTrendBias)
  const fullReportCurrentPrice = isFiniteNumber(latestPrice)
    ? latestPrice
    : isFiniteNumber(fullReportIndicators?.close)
      ? fullReportIndicators.close
      : null
  const fullReportMomentumWidget = resolveMomentumInsightWidget({
    trend: technicalResult?.trend,
    signal: technicalResult?.signal,
    score: technicalScoreValue ?? 50,
    close: fullReportCurrentPrice,
    sma20: technicalData?.sma20 ?? null,
    sma50: technicalData?.sma50 ?? null,
    rsi: fullReportRsiWidget.numericValue,
    macdTone: fullReportMacdWidget.tone,
  })
  const [fullReportNearestSupport] = pickSupportLevels(
    uniqueSortedLevels(fullReportStructure?.support),
    fullReportCurrentPrice,
  )
  const [fullReportNearestResistance] = pickResistanceLevels(
    uniqueSortedLevels(fullReportStructure?.resistance),
    fullReportCurrentPrice,
  )
  const fullReportVolumeSnapshot = buildVolumeSnapshot(ohlcv)
  const fullReportRiskMetrics = buildRiskMetrics({
    recentCloses: fullReportVolumeSnapshot.recentCloses,
    beta: fundamentalData?.beta ?? null,
    currentPrice: fullReportCurrentPrice,
    nearestSupport: fullReportNearestSupport,
    nearestResistance: fullReportNearestResistance,
  })
  const fullReportVolatilityMetric =
    fullReportRiskMetrics.find((metric) => metric.label === 'Volatility (30 day)') ?? null
  const fullReportVolatilityValue = fullReportVolatilityMetric?.value ?? 'N/A'
  const fullReportVolatilityNumericValue = parseMetricNumber(fullReportVolatilityValue)
  const fullReportSma20Position = resolveAveragePositionStatus(
    technicalData?.sma20 ?? null,
    fullReportCurrentPrice,
  )
  const fullReportSma50Position = resolveAveragePositionStatus(
    technicalData?.sma50 ?? null,
    fullReportCurrentPrice,
  )
  const fullReportSma200Position = resolveAveragePositionStatus(
    fullReportSma200,
    fullReportCurrentPrice,
  )
  const fullReportLow52 = technicalData?.['52WeekLow'] ?? null
  const fullReportHigh52 = technicalData?.['52WeekHigh'] ?? null
  const hasFullReport52WeekRange =
    isFiniteNumber(fullReportLow52) &&
    isFiniteNumber(fullReportHigh52) &&
    fullReportHigh52 > fullReportLow52 &&
    isFiniteNumber(fullReportCurrentPrice)
  const fullReportYearRangePercent = hasFullReport52WeekRange
    ? clampPercent(
      ((fullReportCurrentPrice - fullReportLow52) / (fullReportHigh52 - fullReportLow52)) * 100,
    )
    : 50
  const fullReportYearRangeTone: InsightTone = !hasFullReport52WeekRange
    ? 'neutral'
    : fullReportYearRangePercent >= 65
      ? 'bullish'
      : fullReportYearRangePercent <= 35
        ? 'bearish'
        : 'neutral'
  const fullReportYearRangeStatus = !hasFullReport52WeekRange
    ? 'Not available'
    : fullReportYearRangePercent >= 80
      ? 'Near 52W high'
      : fullReportYearRangePercent <= 20
        ? 'Near 52W low'
        : 'Within range'
  const fullReportYearRangeValue = hasFullReport52WeekRange
    ? `${fullReportYearRangePercent.toFixed(1)}%`
    : 'N/A'
  const fullReportMovingAverageAlignment = resolveMovingAverageAlignment({
    price: fullReportCurrentPrice,
    sma20: technicalData?.sma20 ?? null,
    sma50: technicalData?.sma50 ?? null,
    sma200: fullReportSma200,
  })
  const fullReportSnapshotTiles: TechnicalSnapshotRow[] = [
    {
      key: 'trend',
      metric: 'Trend',
      value: safeText(technicalResult?.trend),
      status: toneToLabel(fullReportTrendBias),
      tone: fullReportTrendBias,
      progressPercent: isFiniteNumber(technicalScoreValue)
        ? clampPercent(technicalScoreValue)
        : toneToPercent(fullReportTrendBias),
    },
    {
      key: 'range52',
      metric: '52W Range Position',
      value: fullReportYearRangeValue,
      status: fullReportYearRangeStatus,
      tone: fullReportYearRangeTone,
      progressPercent: fullReportYearRangePercent,
      numeric: hasFullReport52WeekRange
        ? { value: fullReportYearRangePercent, format: 'percent', decimals: 1 }
        : undefined,
    },
    {
      key: 'momentum',
      metric: 'Momentum',
      value: fullReportMomentumWidget.valueText,
      status: fullReportMomentumWidget.signalLabel,
      tone: fullReportMomentumWidget.tone,
      progressPercent: fullReportMomentumWidget.percent,
      numeric: { value: fullReportMomentumWidget.percent, format: 'number', decimals: 1 },
    },
    {
      key: 'volatility',
      metric: 'Volatility',
      value: fullReportVolatilityValue,
      status: fullReportVolatilityMetric
        ? riskLevelLabel(fullReportVolatilityMetric.level)
        : 'Not available',
      tone: fullReportVolatilityMetric
        ? riskLevelToTone(fullReportVolatilityMetric.level)
        : 'neutral',
      progressPercent: isFiniteNumber(fullReportVolatilityNumericValue)
        ? clampPercent((fullReportVolatilityNumericValue / 60) * 100)
        : 50,
      numeric: isFiniteNumber(fullReportVolatilityNumericValue)
        ? { value: fullReportVolatilityNumericValue, format: 'percent', decimals: 1 }
        : undefined,
    },
    {
      key: 'adx',
      metric: 'ADX',
      value: fullReportAdxWidget.valueText,
      status: fullReportAdxWidget.contextLabel,
      tone: fullReportAdxWidget.tone,
      progressPercent: fullReportAdxWidget.percent,
      numeric: isFiniteNumber(fullReportAdxWidget.numericValue)
        ? { value: fullReportAdxWidget.numericValue, format: 'number', decimals: 1 }
        : undefined,
    },
    {
      key: 'rsi',
      metric: 'RSI (14)',
      value: fullReportRsiWidget.valueText,
      status: resolveRsiStatusLabel(fullReportRsiWidget.contextLabel),
      tone: fullReportRsiWidget.tone,
      progressPercent: fullReportRsiWidget.percent,
      numeric: isFiniteNumber(fullReportRsiWidget.numericValue)
        ? { value: fullReportRsiWidget.numericValue, format: 'number', decimals: 1 }
        : undefined,
    },
    {
      key: 'macd',
      metric: 'MACD Signal',
      value: toneToLabel(fullReportMacdWidget.tone),
      status: toneArrow(fullReportMacdWidget.tone),
      tone: fullReportMacdWidget.tone,
      progressPercent: fullReportMacdWidget.percent,
    },
    {
      key: 'sma20',
      metric: '20 Day SMA',
      value: formatCurrency(technicalData?.sma20, fullReportTechnicalCurrency),
      status: fullReportSma20Position.label,
      tone: fullReportSma20Position.tone,
      progressPercent: resolveMovingAverageProgress(
        technicalData?.sma20 ?? null,
        fullReportCurrentPrice,
      ),
      numeric: isFiniteNumber(technicalData?.sma20)
        ? {
          value: technicalData.sma20,
          format: 'currency',
          decimals: 2,
          currency: fullReportTechnicalCurrency,
        }
        : undefined,
    },
    {
      key: 'sma50',
      metric: '50 Day SMA',
      value: formatCurrency(technicalData?.sma50, fullReportTechnicalCurrency),
      status: fullReportSma50Position.label,
      tone: fullReportSma50Position.tone,
      progressPercent: resolveMovingAverageProgress(
        technicalData?.sma50 ?? null,
        fullReportCurrentPrice,
      ),
      numeric: isFiniteNumber(technicalData?.sma50)
        ? {
          value: technicalData.sma50,
          format: 'currency',
          decimals: 2,
          currency: fullReportTechnicalCurrency,
        }
        : undefined,
    },
    {
      key: 'sma200',
      metric: '200 Day SMA',
      value: formatCurrency(fullReportSma200, fullReportTechnicalCurrency),
      status: fullReportSma200Position.label,
      tone: fullReportSma200Position.tone,
      progressPercent: resolveMovingAverageProgress(fullReportSma200, fullReportCurrentPrice),
      numeric: isFiniteNumber(fullReportSma200)
        ? {
          value: fullReportSma200,
          format: 'currency',
          decimals: 2,
          currency: fullReportTechnicalCurrency,
        }
        : undefined,
    },
  ]
  const shareholding = buildShareholdingDistribution(fundamentalData?.shareholdingPattern)
  const shareSecondBreak = shareholding.institutional + shareholding.retail
  const shareRingBackground = `conic-gradient(#0c4ab8 0 ${shareholding.institutional.toFixed(2)}%, #afc1ff ${shareholding.institutional.toFixed(2)}% ${shareSecondBreak.toFixed(2)}%, #d8dfee ${shareSecondBreak.toFixed(2)}% 100%)`
  const ownershipBreakdown: Array<{ label: 'Institutional' | 'Retail' | 'Promoter'; value: number }> = [
    { label: 'Institutional', value: shareholding.institutional },
    { label: 'Retail', value: shareholding.retail },
    { label: 'Promoter', value: shareholding.promoter },
  ]
  const dominantOwnership = ownershipBreakdown.reduce((top, current) =>
    current.value > top.value ? current : top,
    ownershipBreakdown[0])
  const concentrationPercent = shareholding.institutional + shareholding.promoter
  const concentrationLabel = concentrationPercent >= 80
    ? 'High Concentration'
    : concentrationPercent >= 60
      ? 'Moderate Concentration'
      : 'Broadly Distributed'
  const analystCoverageCount = fundamentalData?.numberOfAnalystOpinions
  const analystCoverageLabel = isFiniteNumber(analystCoverageCount)
    ? `${Math.round(analystCoverageCount)} Analysts`
    : 'N/A'
  const ownershipSignal = concentrationPercent >= 80
    ? 'Ownership is concentrated; large holder activity can increase short-term volatility.'
    : concentrationPercent >= 60
      ? 'Ownership is fairly stable with institutional and promoter support.'
      : 'Ownership is diversified, which can improve liquidity and reduce concentration risk.'
  const reportSourceLabel = analysis.reportSource
    ? analysis.reportSource.toUpperCase()
    : null
  const fullReportSnapshotSectionRef = useRef<HTMLElement | null>(null)
  const isFullReportSnapshotInView = useInViewOnce(fullReportSnapshotSectionRef, { threshold: 0.2 })

  return (
    <article className={`full-report-dashboard reveal theme-${theme}`}>
      <div className="full-report-top-bar">
        <nav className="full-report-breadcrumbs" aria-label="Report breadcrumb">
          <span>{sectorLabel}</span>
          <span className="separator">/</span>
          <span>{industryLabel}</span>
          <span className="separator">/</span>
          <span className="active">{companyName}</span>
        </nav>
        {user && (
          <button
            type="button"
            className="report-download-btn"
            onClick={handleDownloadPdf}
            disabled={isDownloadingPdf || isGeneratingReport}
          >
            {isDownloadingPdf ? (
              <>
                <span className="report-download-spinner" aria-hidden="true" />
                Generating PDF...
              </>
            ) : isGeneratingReport ? (
              <>
                <span className="report-download-spinner" aria-hidden="true" />
                Preparing Report...
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 1v9m0 0L5 7m3 3 3-3M2 12v1.5A1.5 1.5 0 0 0 3.5 15h9a1.5 1.5 0 0 0 1.5-1.5V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Download PDF Report
              </>
            )}
          </button>
        )}
      </div>
      {pdfDownloadError && (
        <p className="full-report-download-error" role="status">
          {pdfDownloadError}
        </p>
      )}

      <section className="full-report-hero">
        <div className="full-report-hero-left">
          <div className="full-report-title-row">
            <h2>{companyName} ({analysis.ticker})</h2>
            <span className="full-report-exchange-tag">
              {inferExchangeLabel({
                ticker: analysis.ticker,
                symbol: fundamentalData?.symbol,
                exchange: fundamentalData?.exchange,
                fullExchangeName: fundamentalData?.fullExchangeName,
              })}
            </span>
          </div>
          <div className="full-report-price-strip">
            <div className="full-report-price-block">
              <span className="full-report-price">{formatCurrency(latestPrice, displayCurrency)}</span>
              {isFiniteNumber(priceChange) && isFiniteNumber(priceChangePercent) ? (
                <span className={`full-report-price-change ${priceToneClass}`}>
                  {formatSignedNumber(Number(priceChange.toFixed(2)))} {' '}
                  {formatSignedPercent(priceChangePercent)}
                </span>
              ) : (
                <span className="full-report-price-change neutral">Price change unavailable</span>
              )}
            </div>
            <div className="full-report-hero-metric">
              <span>Market Cap</span>
              <strong>{marketCapLabel}</strong>
            </div>
          </div>
        </div>


      </section>

      <div className="full-report-main-grid">
        <div className="full-report-main-col">
          <article className="full-report-card full-report-executive-card">
            <h3>
              <span className="accent-line" aria-hidden="true" />
              Executive Briefing
            </h3>
            <div className="full-report-executive-content">
              <p>{executiveBriefing}</p>
            </div>
          </article>

          <div className="full-report-mid-grid">
            <article className="full-report-card full-report-revenue-card">
              <h4>Revenue &amp; Profit Trend (USD Bn)</h4>
              <div className="full-report-revenue-bars" aria-hidden="true">
                {revenueRows.map((row, index) => (
                  <div key={`${row.label}-${index}`} className="full-report-revenue-col">
                    <div className="full-report-revenue-tooltip" role="presentation">
                      <p>{row.label}</p>
                      <span>Revenue: {formatCurrency(row.revenueValue, displayCurrency)}</span>
                      <span>Net Profit: {formatCurrency(row.profitValue, displayCurrency)}</span>
                    </div>
                    <div className="full-report-revenue-track">
                      <div className="full-report-revenue-bar-group">
                        <div
                          className="full-report-revenue-bar"
                          style={{ height: `${row.revenueHeight}%` }}
                        />
                        <div
                          className="full-report-profit-bar"
                          style={{ height: `${row.profitHeight}%` }}
                        />
                      </div>
                    </div>
                    <span>{row.label}</span>
                  </div>
                ))}
              </div>
              <div className="full-report-revenue-legend">
                <span>
                  <i className="revenue" aria-hidden="true" />
                  Revenue
                </span>
                <span>
                  <i className="profit" aria-hidden="true" />
                  Net Profit
                </span>
              </div>
            </article>

            <article className="full-report-card full-report-metrics-card">
              <h4>Key Performance Metrics</h4>
              <ul>
                {performanceMetrics.map((metric) => (
                  <li key={metric.label}>
                    <span>{metric.label}</span>
                    <strong className={metric.highlight ? 'is-highlight' : undefined}>
                      {metric.value}
                    </strong>
                  </li>
                ))}
              </ul>
            </article>
          </div>

          <section
            ref={fullReportSnapshotSectionRef}
            className="technical-snapshot-section"
            aria-label="Technical snapshot"
          >
            <div className="technical-snapshot-panels">
              <article className="snapshot-panel">
                <header className="snapshot-panel-head">
                  <h4>Technical Snapshot</h4>
                  <span className={`snapshot-badge tone-${fullReportMovingAverageAlignment.tone}`}>
                    {fullReportMovingAverageAlignment.label}
                  </span>
                </header>
                <div className="snapshot-tiles-grid">
                  {fullReportSnapshotTiles.map((tile, index) => (
                    <SnapshotMetricTile
                      key={`full-report-${tile.key}`}
                      tile={tile}
                      index={index}
                      isAnimated={isFullReportSnapshotInView}
                    />
                  ))}
                </div>
              </article>
            </div>
          </section>
        </div>

        <aside className="full-report-side-col">
          <article className="full-report-card full-report-share-card">
            <h4>Shareholding Pattern</h4>
            <div className="full-report-share-ring" style={{ background: shareRingBackground }}>
              <div className="full-report-share-center">
                <strong>{wholeNumberFormatter.format(Math.round(shareholding.institutional))}%</strong>
                <span>Institutional</span>
              </div>
            </div>
            <ul className="full-report-share-list">
              <li>
                <span><i className="institutional" aria-hidden="true" />Institutional</span>
                <strong>{shareholding.institutional.toFixed(1)}%</strong>
              </li>
              <li>
                <span><i className="retail" aria-hidden="true" />Retail</span>
                <strong>{shareholding.retail.toFixed(1)}%</strong>
              </li>
              <li>
                <span><i className="promoter" aria-hidden="true" />Promoter</span>
                <strong>{shareholding.promoter.toFixed(1)}%</strong>
              </li>
            </ul>
          </article>

          <article className="full-report-card full-report-ownership-card">
            <h4>Ownership Insights</h4>
            <ul className="full-report-ownership-list">
              <li>
                <span>Dominant Holder</span>
                <strong>{dominantOwnership.label} ({dominantOwnership.value.toFixed(1)}%)</strong>
              </li>
              <li>
                <span>Concentration</span>
                <strong>{concentrationLabel}</strong>
              </li>
              <li>
                <span>Locked Ownership</span>
                <strong>{concentrationPercent.toFixed(1)}%</strong>
              </li>
              <li>
                <span>Analyst Coverage</span>
                <strong>{analystCoverageLabel}</strong>
              </li>
            </ul>
            <p className="full-report-ownership-note">{ownershipSignal}</p>
          </article>

          <article className="full-report-card full-report-risk-card">
            <h4>Risk Factors</h4>
            <ul>
              {riskItems.map((item, index) => (
                <li key={`risk-${index}`}>{item}</li>
              ))}
            </ul>
          </article>
        </aside>
      </div>

      <section className="full-report-detailed-grid">
        <article className="full-report-card full-report-summary-card">
          <div className="full-report-summary-head">
            <h4>Fundamental Summary</h4>
            <span className={`full-report-summary-indicator tone-${fundamentalIndicatorTone}`}>
              {fundamentalSignalLabel}
            </span>
          </div>
          <FullReportScoreMeter
            zone={fundamentalScoreZone}
            percent={fundamentalScorePercent}
            scoreLabel={fundamentalScoreLabel}
            tickPrefix="fundamental"
          />
          <ul>
            {fundamentalSummaryPoints.map((item, index) => (
              <li key={`fundamental-summary-${index}`}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="full-report-card full-report-summary-card">
          <div className="full-report-summary-head">
            <h4>Technical Summary</h4>
            <span className={`full-report-summary-indicator tone-${technicalIndicatorTone}`}>
              {technicalSignalLabel}
            </span>
          </div>
          <FullReportScoreMeter
            zone={technicalScoreZone}
            percent={technicalScorePercent}
            scoreLabel={technicalScoreLabel}
            tickPrefix="technical"
          />
          <ul>
            {technicalSummaryPoints.map((item, index) => (
              <li key={`technical-summary-${index}`}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="full-report-card full-report-summary-card">
          <div className="full-report-summary-head">
            <h4>Sentiment Summary</h4>
            <span className={`full-report-summary-indicator tone-${sentimentIndicatorTone}`}>
              {sentimentSignalLabel}
            </span>
          </div>
          <FullReportScoreMeter
            zone={sentimentScoreZone}
            percent={sentimentScorePercent}
            scoreLabel={sentimentScoreLabel}
            tickPrefix="sentiment"
          />
          {sentimentSummaryPoints.length > 0 && (
            <ul>
              {sentimentSummaryPoints.map((item, index) => (
                <li key={`sentiment-summary-${index}`}>{item}</li>
              ))}
            </ul>
          )}
        </article>
      </section>

      {reportSourceLabel && (
        <p className="full-report-source-note">Report source: {reportSourceLabel}</p>
      )}
    </article>
  )
}

function FullReportScoreMeter({
  zone,
  percent,
  scoreLabel,
  tickPrefix,
}: {
  zone: ScoreZone
  percent: number
  scoreLabel: string
  tickPrefix: string
}) {
  return (
    <div className={`technical-score-meter-wrap zone-${zone} full-report-score-row`}>
      <div className="technical-score-meter-visual" aria-hidden="true">
        <div className="technical-score-meter-track">
          <div className="technical-score-meter-segments">
            <span className="segment strong-bearish" />
            <span className="segment bearish" />
            <span className="segment neutral" />
            <span className="segment bullish" />
            <span className="segment strong-bullish" />
          </div>
          <span className="technical-score-meter-marker" style={{ left: `${percent}%` }} />
        </div>
        <div className="technical-score-meter-scale">
          {[0, 25, 50, 75, 100].map((tick) => (
            <span
              key={`${tickPrefix}-tick-${tick}`}
              className={`technical-score-meter-tick${tick === 0 ? ' edge-start' : ''}${tick === 100 ? ' edge-end' : ''}`}
              style={{ left: `${tick}%` }}
            >
              <span className="technical-score-meter-tick-mark" />
              <span className="technical-score-meter-tick-label">{tick}</span>
            </span>
          ))}
        </div>
      </div>
      <span className="full-report-score-value">{scoreLabel}</span>
    </div>
  )
}

type RevenueBarRow = {
  label: string
  revenueHeight: number
  profitHeight: number
  revenueValue: number | null
  profitValue: number | null
}

type ShareholdingDistribution = {
  institutional: number
  retail: number
  promoter: number
}

function sanitizeReportText(raw: string | null | undefined): string {
  if (!raw) {
    return ''
  }
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function summarizeForCard(
  raw: string | null | undefined,
  fallback: string,
  _maxLength: number,
): string {
  const cleaned = sanitizeReportText(raw)
  if (!cleaned) {
    return fallback
  }
  return cleaned
}

function pickPrimaryInsight(
  raw: string | null | undefined,
  fallback: string,
  _maxLength: number,
): string {
  const bullets = raw
    ? extractBulletPoints(raw)
      .map((item) => sanitizeReportText(item))
      .filter(Boolean)
    : []
  if (bullets.length > 0) {
    return bullets.slice(0, 3).join(' ')
  }

  const cleaned = sanitizeReportText(raw)
  if (cleaned) {
    return cleaned
  }
  return fallback
}

function buildRiskItems(raw: string | null | undefined): string[] {
  const bulletItems = raw
    ? extractBulletPoints(raw)
      .map((item) => sanitizeReportText(item))
      .filter(Boolean)
      .slice(0, 3)
    : []
  if (bulletItems.length > 0) {
    return bulletItems
  }

  const cleaned = sanitizeReportText(raw)
  if (cleaned) {
    const sentences = cleaned
      .split(/(?<=[.!?])\s+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3)
    if (sentences.length > 0) {
      return sentences
    }
    return [cleaned]
  }

  return [
    'Supply-chain concentration can amplify cost and delivery shocks.',
    'Regulatory and legal developments may pressure valuation multiples.',
    'Execution risk increases when demand slows in core segments.',
  ]
}

function buildRevenueTrendRows(
  trend: FundamentalData['revenueTrend'] | undefined,
): RevenueBarRow[] {
  const fallback: RevenueBarRow[] = [
    { label: '2021', revenueHeight: 42, profitHeight: 12, revenueValue: null, profitValue: null },
    { label: '2022', revenueHeight: 58, profitHeight: 15, revenueValue: null, profitValue: null },
    { label: '2023', revenueHeight: 74, profitHeight: 18, revenueValue: null, profitValue: null },
    { label: '2024E', revenueHeight: 90, profitHeight: 23, revenueValue: null, profitValue: null },
  ]
  if (!trend || trend.length === 0) {
    return fallback
  }

  const recent = trend.slice(-4)

  const maxScale = recent.reduce((max, row) => {
    const revenue = isFiniteNumber(row.revenue) && row.revenue > 0 ? row.revenue : 0
    const profit = isFiniteNumber(row.netProfit) && row.netProfit > 0 ? row.netProfit : 0
    return Math.max(max, revenue, profit)
  }, 0)
  if (maxScale <= 0) {
    return fallback
  }

  const scaledHeight = (value: number | null | undefined, minVisibleHeight: number) => {
    if (!isFiniteNumber(value) || value <= 0) {
      return 0
    }
    return Math.max(minVisibleHeight, Math.min(100, (value / maxScale) * 100))
  }

  return recent.map((row, index) => {
    const revenueHeight = scaledHeight(row.revenue, 18)
    const profitHeight = scaledHeight(row.netProfit, 10)
    return {
      label: index === recent.length - 1 ? `${row.year}E` : `${row.year}`,
      revenueHeight,
      profitHeight,
      revenueValue: isFiniteNumber(row.revenue) ? row.revenue : null,
      profitValue: isFiniteNumber(row.netProfit) ? row.netProfit : null,
    }
  })
}

function normalizeSharePercent(value: number | null | undefined): number {
  if (!isFiniteNumber(value)) {
    return 0
  }
  if (value <= 1) {
    return value * 100
  }
  return value
}

function buildShareholdingDistribution(
  pattern: FundamentalData['shareholdingPattern'] | undefined,
): ShareholdingDistribution {
  const institutional = normalizeSharePercent(pattern?.institutions)
  const retail = normalizeSharePercent(pattern?.public)
  const promoter = normalizeSharePercent(pattern?.promoters)
  const total = institutional + retail + promoter
  if (total <= 0) {
    return { institutional: 60.2, retail: 25.4, promoter: 14.4 }
  }
  return {
    institutional: (institutional / total) * 100,
    retail: (retail / total) * 100,
    promoter: (promoter / total) * 100,
  }
}

function formatCompactMoney(
  value: number | null | undefined,
  currency: string,
): string {
  if (!isFiniteNumber(value)) {
    return 'N/A'
  }
  const normalizedCurrency = normalizeCurrencyCode(currency)
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: normalizedCurrency,
      notation: 'compact',
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${compactFormatter.format(value)} ${normalizedCurrency}`
  }
}

function inferExchangeLabel(input: {
  ticker: string
  symbol?: string | null
  exchange?: string | null
  fullExchangeName?: string | null
}): string {
  const directExchange = `${input.fullExchangeName ?? input.exchange ?? ''}`.trim().toUpperCase()
  if (directExchange) {
    if (
      directExchange.includes('NASDAQ') ||
      directExchange === 'NMS' ||
      directExchange === 'NGM' ||
      directExchange === 'NCM'
    ) {
      return 'NASDAQ'
    }
    if (directExchange.includes('NEW YORK') || directExchange === 'NYQ' || directExchange === 'NYSE') {
      return 'NYSE'
    }
    if (directExchange.includes('NSE') || directExchange === 'NSI') {
      return 'NSE'
    }
    if (directExchange.includes('BSE') || directExchange === 'BSE') {
      return 'BSE'
    }
    if (directExchange.includes('LSE') || directExchange === 'LSE') {
      return 'LSE'
    }
    if (directExchange.includes('TORONTO') || directExchange === 'TOR') {
      return 'TSX'
    }
    return directExchange
  }

  const tickerOrSymbol = (input.symbol || input.ticker || '').trim().toUpperCase()
  if (tickerOrSymbol.endsWith('.NS')) {
    return 'NSE'
  }
  if (tickerOrSymbol.endsWith('.BO')) {
    return 'BSE'
  }
  if (tickerOrSymbol.endsWith('.L')) {
    return 'LSE'
  }
  if (tickerOrSymbol.endsWith('.TO')) {
    return 'TSX'
  }
  return 'N/A'
}

function formatSignedPercent(value: number): string {
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(2)}%`
}

function buildSectionSummaryPoints(
  raw: string | null | undefined,
  fallback: string,
): string[] {
  const fromBullets = raw
    ? extractBulletPoints(raw)
      .map((item) => sanitizeReportText(item))
      .filter(Boolean)
    : []
  if (fromBullets.length > 0) {
    return fromBullets.slice(0, 6)
  }

  const cleaned = sanitizeReportText(raw)
  if (cleaned) {
    const sentences = cleaned
      .split(/(?<=[.!?])\s+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 6)
    if (sentences.length > 0) {
      return sentences
    }
  }

  return [sanitizeReportText(fallback) || fallback]
}

function emphasizeSummaryLabel(text: string): string {
  return text.replace(/^(\s*)Summary:\s*/gim, '$1**Summary:** ')
}

function normalizeInlineBulletLists(text: string): string {
  // Strict bullet boundary: only ". -" should be treated as a new bullet.
  return text.replace(/\. (?=-\s+\S)/g, '.\n')
}

function renderSection(
  tab: AnalysisTab,
  analysis: AnalysisResponse,
  ticker: string,
  isGeneratingReport: boolean = false,
  user?: import('./types').AuthUser | null,
  theme?: 'light' | 'dark'
) {
  const llmSections: Partial<ReportSections> = analysis.reportSections ?? {}
  const displayCurrency = resolveAnalysisCurrency(analysis)

  const getLlmSummary = (key: keyof ReportSections): string | undefined => {
    if (llmSections[key]) return llmSections[key]
    if (isGeneratingReport) return 'Generating Summary...'
    return undefined
  }

  switch (tab) {
    case 'fundamental':
      return (
        <FundamentalSection
          result={analysis.fundamental}
          llmSummary={getLlmSummary('fundamental')}
          displayCurrency={displayCurrency}
          theme={theme}
        />
      )
    case 'technical':
      return (
        <TechnicalSection
          result={analysis.technical}
          llmSummary={getLlmSummary('technical')}
          ticker={ticker}
          beta={analysis.fundamental?.data?.beta ?? null}
          displayCurrency={displayCurrency}
          theme={theme}
        />
      )
    case 'sentiment':
      return (
        <SentimentSection
          result={analysis.sentiment}
          llmSummary={getLlmSummary('sentiment')}
          theme={theme}
        />
      )
    case 'full-report':
      // Show full report section, but if generating, maybe we can wait or show a placeholder in FullReportSection 
      // FullReportSection receives analysis which already has report as undefined, so it might say unavailable. 
      // We will handle FullReportSection below if needed.
      return (
        <FullReportSection
          analysis={analysis}
          isGeneratingReport={isGeneratingReport}
          user={user}
          theme={theme}
        />
      )
    case 'overview':
    default:
      return (
        <OverviewSection
          overview={analysis.overview}
          llmSummary={getLlmSummary('overall')}
          technical={analysis.technical}
          sentiment={analysis.sentiment}
          sentimentLlm={getLlmSummary('sentiment')}
          ticker={ticker}
          displayCurrency={displayCurrency}
          theme={theme}
        />
      )
  }
}

type MetricListProps = {
  rows: Array<[string, string]>
}

function MetricList({ rows }: MetricListProps) {
  return (
    <dl className="metric-list">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

type UnavailablePanelProps = {
  title: string
  children: string
}

function UnavailablePanel({ title, children }: UnavailablePanelProps) {
  return (
    <article className="panel reveal">
      <header className="panel-head">
        <h2>{title}</h2>
        <span className="score-tag muted">N/A</span>
      </header>
      <p className="analysis-copy">{children}</p>
    </article>
  )
}

function LoadingPanel({ tab }: { tab: AnalysisTab }) {
  const label = ANALYSIS_TABS.find((item) => item.key === tab)?.label ?? 'Analysis'
  return (
    <article className="panel reveal loading-panel">
      <header className="panel-head">
        <h2>{label} Analysis</h2>
      </header>
      <div className="loading-lines">
        <span />
        <span />
        <span />
      </div>
    </article>
  )
}

function usePathRouter() {
  const [locationState, setLocationState] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }))

  useEffect(() => {
    const onPopState = () => {
      setLocationState({
        pathname: window.location.pathname,
        search: window.location.search,
      })
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
    }
  }, [])

  const navigate = useCallback((
    path: string,
    options?: { replace?: boolean },
  ) => {
    const target = new URL(path, window.location.origin)
    const current = `${window.location.pathname}${window.location.search}`
    const next = `${target.pathname}${target.search}`
    if (next !== current) {
      if (options?.replace) {
        window.history.replaceState({}, '', next)
      } else {
        window.history.pushState({}, '', next)
      }
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    setLocationState({
      pathname: target.pathname,
      search: target.search,
    })
  }, [])

  return { pathname: locationState.pathname, search: locationState.search, navigate }
}

function parseRoute(pathname: string): AppRoute {
  if (/^\/login\/?$/i.test(pathname)) {
    return { type: 'auth', mode: 'login' }
  }

  if (/^\/signup\/?$/i.test(pathname)) {
    return { type: 'auth', mode: 'signup' }
  }

  if (/^\/compare\/?$/i.test(pathname)) {
    return { type: 'compare' }
  }

  if (/^\/profile\/?$/i.test(pathname)) {
    return { type: 'profile' }
  }

  const match = pathname.match(/^\/stock\/([^/]+)(?:\/([^/]+))?\/?$/i)
  if (!match) {
    return { type: 'home' }
  }

  try {
    const ticker = normalizeTicker(decodeURIComponent(match[1]))
    if (!ticker) {
      return { type: 'home' }
    }

    const tab = normalizeTab(match[2] ?? '')
    return { type: 'stock', ticker, tab }
  } catch {
    return { type: 'home' }
  }
}

function normalizeTab(value: string): AnalysisTab {
  const raw = value.trim().toLowerCase()
  if (
    raw === 'fundamental' ||
    raw === 'technical' ||
    raw === 'sentiment' ||
    raw === 'full-report' ||
    raw === 'discussion'
  ) {
    return raw
  }
  return 'overview'
}

function normalizeTicker(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, '')
}

function toTradingViewSymbol(symbol: string): string {
  const clean = symbol.trim().toUpperCase()
  if (!clean) {
    return 'AAPL'
  }
  if (clean.includes(':')) {
    return clean
  }
  return clean
}

// Legacy TradingView helpers removed now that charts use Lightweight Charts.

function formatScore(score: number | null): string {
  if (typeof score !== 'number') {
    return 'N/A'
  }
  return score.toFixed(1)
}

function scoreBand(score: number | null): string {
  if (typeof score !== 'number') {
    return 'Unknown'
  }
  if (score >= 65) {
    return 'Bullish'
  }
  if (score >= 45) {
    return 'Neutral'
  }
  return 'Bearish'
}

type ScoreZone = 'strong-bearish' | 'bearish' | 'neutral' | 'bullish' | 'strong-bullish'

function resolveScoreZone(score: number | null): ScoreZone {
  if (!isFiniteNumber(score)) {
    return 'neutral'
  }
  if (score < 30) {
    return 'strong-bearish'
  }
  if (score < 45) {
    return 'bearish'
  }
  if (score < 55) {
    return 'neutral'
  }
  if (score < 70) {
    return 'bullish'
  }
  return 'strong-bullish'
}

function resolveFundamentalSignalLabel(score: number | null): string {
  if (!isFiniteNumber(score)) {
    return 'N/A'
  }
  if (score < 30) {
    return 'Weak'
  }
  if (score < 45) {
    return 'Below Avg'
  }
  if (score < 55) {
    return 'Average'
  }
  if (score < 70) {
    return 'Good'
  }
  return 'Strong'
}

function resolveSentimentSignalLabel(score: number | null): string {
  if (!isFiniteNumber(score)) {
    return 'N/A'
  }
  if (score < 30) {
    return 'Very Negative'
  }
  if (score < 45) {
    return 'Negative'
  }
  if (score < 55) {
    return 'Mixed'
  }
  if (score < 70) {
    return 'Positive'
  }
  return 'Very Positive'
}

function toneFromVerdict(verdict: string): string {
  const value = verdict.toLowerCase()
  if (value === 'buy') {
    return 'positive'
  }
  if (value === 'hold') {
    return 'neutral'
  }
  if (value === 'sell') {
    return 'negative'
  }
  return 'neutral'
}

function toneFromScore(score: number | null, up: number = 60, down: number = 40): string {
  if (score === null) return 'neutral'
  if (score >= up) return 'positive'
  if (score >= down) return 'neutral'
  return 'negative'
}

function formatNumber(value: number | null | undefined): string {
  if (typeof value !== 'number') {
    return 'N/A'
  }
  return decimalFormatter.format(value)
}

function ColoredValue({ value, formatFn }: { value: number | null | undefined, formatFn: (v: number | null | undefined) => string }) {
  const isNa = typeof value !== 'number'
  const text = formatFn(value)
  if (isNa) {
    return <span>{text}</span>
  }

  if ((value as number) > 0) {
    return <span className="val-positive">{text}</span>
  } else if ((value as number) < 0) {
    return <span className="val-negative">{text}</span>
  }
  return <span>{text}</span>
}



function formatPercent(value: number | null | undefined): string {
  if (typeof value !== 'number') {
    return 'N/A'
  }
  return `${(value * 100).toFixed(2)}%`
}

function normalizeCurrencyCode(currency: string | null | undefined): string {
  if (!currency) {
    return 'USD'
  }
  const normalized = currency.trim().toUpperCase()
  return normalized || 'USD'
}

function getCurrencyFormatter(currency: string): Intl.NumberFormat | null {
  const normalized = normalizeCurrencyCode(currency)
  const cached = currencyFormatterCache.get(normalized)
  if (cached) {
    return cached
  }
  try {
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: normalized,
      maximumFractionDigits: 2,
    })
    currencyFormatterCache.set(normalized, formatter)
    return formatter
  } catch {
    return null
  }
}

function formatCurrency(
  value: number | null | undefined,
  currency: string,
): string {
  if (!isFiniteNumber(value)) {
    return 'N/A'
  }
  const normalized = normalizeCurrencyCode(currency)
  const formatter = getCurrencyFormatter(normalized)
  if (formatter) {
    return formatter.format(value)
  }
  return `${decimalFormatter.format(value)} ${normalized}`
}

function formatPrimaryLevel(
  levels: number[] | null | undefined,
  currency: string,
): string {
  if (!Array.isArray(levels) || levels.length === 0) {
    return 'N/A'
  }
  const first = levels.find((level) => typeof level === 'number' && Number.isFinite(level))
  if (typeof first !== 'number') {
    return 'N/A'
  }
  return formatCurrency(first, currency)
}

function resolveAnalysisCurrency(analysis: AnalysisResponse): string {
  const fundamentalCurrency = analysis.fundamental?.data?.currency
  const technicalCurrency =
    analysis.technical?.data?.currency ?? analysis.technical?.currency
  return normalizeCurrencyCode(fundamentalCurrency ?? technicalCurrency)
}

function safeText(value: string | null | undefined): string {
  if (!value) {
    return 'N/A'
  }
  return value
}

type InsightWidgetState = {
  tone: InsightTone
  valueText: string
  contextLabel: string
  percent: number
  numericValue: number | null
}

type TechnicalSnapshotRow = {
  key: string
  metric: string
  value: string
  status: string
  tone: InsightTone
  progressPercent: number
  numeric?: {
    value: number
    format: 'number' | 'currency' | 'percent'
    decimals: number
    currency?: string
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function toneToPercent(tone: InsightTone): number {
  if (tone === 'bullish') {
    return 78
  }
  if (tone === 'bearish') {
    return 22
  }
  return 50
}

function parseMetricNumber(value: string): number | null {
  const cleaned = value.replace(/[^0-9.+-]/g, '')
  const parsed = Number.parseFloat(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function resolveMovingAverageProgress(
  movingAverage: number | null,
  currentPrice: number | null,
): number {
  if (!isFiniteNumber(movingAverage) || !isFiniteNumber(currentPrice) || movingAverage === 0) {
    return 50
  }
  const deltaPercent = ((currentPrice - movingAverage) / movingAverage) * 100
  return clampPercent(50 + deltaPercent * 5)
}

function useAnimatedNumber(
  target: number | null,
  durationMs: number,
  shouldAnimate = true,
): number | null {
  const [animated, setAnimated] = useState(0)

  useEffect(() => {
    if (!isFiniteNumber(target)) {
      setAnimated(0)
      return
    }

    if (!shouldAnimate) {
      setAnimated(0)
      return
    }

    let frame = 0
    const startValue = 0
    const startTime = performance.now()

    const step = (timestamp: number) => {
      const elapsed = timestamp - startTime
      const progress = Math.min(1, elapsed / durationMs)
      const eased =
        progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - ((-2 * progress + 2) ** 3) / 2
      setAnimated(startValue + (target - startValue) * eased)
      if (progress < 1) {
        frame = requestAnimationFrame(step)
      }
    }

    setAnimated(0)
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target, durationMs, shouldAnimate])

  return isFiniteNumber(target) ? animated : null
}

function useInViewOnce<T extends Element>(
  ref: React.RefObject<T | null>,
  options?: IntersectionObserverInit,
): boolean {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (isVisible) {
      return
    }

    const node = ref.current
    if (!node) {
      return
    }

    if (typeof IntersectionObserver === 'undefined') {
      const frame = requestAnimationFrame(() => {
        setIsVisible(true)
      })
      return () => cancelAnimationFrame(frame)
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
          break
        }
      }
    }, options)

    observer.observe(node)
    return () => observer.disconnect()
  }, [isVisible, options, ref])

  return isVisible
}

function formatFixedDecimal(value: number, decimals: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function formatAnimatedSnapshotValue(
  value: number,
  numeric: NonNullable<TechnicalSnapshotRow['numeric']>,
): string {
  if (numeric.format === 'currency') {
    return formatCurrency(value, numeric.currency ?? 'USD')
  }
  if (numeric.format === 'percent') {
    return `${formatFixedDecimal(value, numeric.decimals)}%`
  }
  return formatFixedDecimal(value, numeric.decimals)
}

function toneToLabel(tone: InsightTone): 'Bullish' | 'Bearish' | 'Neutral' {
  if (tone === 'bullish') {
    return 'Bullish'
  }
  if (tone === 'bearish') {
    return 'Bearish'
  }
  return 'Neutral'
}

function toneArrow(tone: InsightTone): string {
  if (tone === 'bullish') {
    return '▲'
  }
  if (tone === 'bearish') {
    return '▼'
  }
  return '■'
}

function scoreToTone(score: number | null): InsightTone {
  if (!isFiniteNumber(score)) {
    return 'neutral'
  }
  if (score >= 65) {
    return 'bullish'
  }
  if (score >= 45) {
    return 'neutral'
  }
  return 'bearish'
}

function resolveRsiStatusLabel(contextLabel: string): string {
  const value = contextLabel.toLowerCase()
  if (value.includes('oversold')) {
    return 'Oversold'
  }
  if (value.includes('overbought')) {
    return 'Overbought'
  }
  if (value.includes('neutral')) {
    return 'Neutral'
  }
  if (value.includes('unavailable')) {
    return 'Not available'
  }
  return contextLabel
}

function resolveAveragePositionStatus(
  movingAverage: number | null,
  currentPrice: number | null,
): { label: string; tone: InsightTone } {
  if (!isFiniteNumber(movingAverage) || !isFiniteNumber(currentPrice)) {
    return { label: 'Not available', tone: 'neutral' }
  }

  const deltaPercent = ((currentPrice - movingAverage) / movingAverage) * 100
  if (Math.abs(deltaPercent) <= 0.4) {
    return { label: 'Near Price', tone: 'neutral' }
  }

  if (currentPrice > movingAverage) {
    return { label: 'Below Price', tone: 'bullish' }
  }
  return { label: 'Above Price', tone: 'bearish' }
}

function formatSignedNumber(value: number): string {
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${decimalFormatter.format(value)}`
}

function resolveTrendBias(trend?: string, signal?: string): InsightTone {
  const combined = `${trend ?? ''} ${signal ?? ''}`.toLowerCase()
  const bullishTokens = ['bull', 'buy', 'uptrend', 'upward', 'positive']
  const bearishTokens = ['bear', 'sell', 'downtrend', 'downward', 'negative']
  const hasBullish = bullishTokens.some((token) => combined.includes(token))
  const hasBearish = bearishTokens.some((token) => combined.includes(token))

  if (hasBullish && !hasBearish) {
    return 'bullish'
  }
  if (hasBearish && !hasBullish) {
    return 'bearish'
  }
  return 'neutral'
}

function resolveRsiInsightWidget(rawRsi: number | null | undefined): InsightWidgetState {
  if (!isFiniteNumber(rawRsi)) {
    return {
      tone: 'neutral',
      valueText: 'N/A',
      contextLabel: 'RSI unavailable',
      percent: 50,
      numericValue: null,
    }
  }

  if (rawRsi < 30) {
    return {
      tone: 'bullish',
      valueText: decimalFormatter.format(rawRsi),
      contextLabel: 'Oversold zone (<30)',
      percent: clampPercent(rawRsi),
      numericValue: rawRsi,
    }
  }
  if (rawRsi > 70) {
    return {
      tone: 'bearish',
      valueText: decimalFormatter.format(rawRsi),
      contextLabel: 'Overbought zone (>70)',
      percent: clampPercent(rawRsi),
      numericValue: rawRsi,
    }
  }
  return {
    tone: 'neutral',
    valueText: decimalFormatter.format(rawRsi),
    contextLabel: 'Neutral range (30-70)',
    percent: clampPercent(rawRsi),
    numericValue: rawRsi,
  }
}

function resolveMacdInsightWidget(
  rawMacd: number | undefined,
  rawSignal: number | undefined,
): InsightWidgetState {
  const macd = isFiniteNumber(rawMacd) ? rawMacd : null
  const signal = isFiniteNumber(rawSignal) ? rawSignal : null
  const reference = signal ?? macd

  if (reference === null) {
    return {
      tone: 'neutral',
      valueText: 'N/A',
      contextLabel: 'Signal unavailable',
      percent: 50,
      numericValue: null,
    }
  }

  const delta = macd !== null && signal !== null ? macd - signal : reference
  const threshold = 0.05
  let tone: InsightTone = 'neutral'
  if (delta > threshold) {
    tone = 'bullish'
  } else if (delta < -threshold) {
    tone = 'bearish'
  }

  return {
    tone,
    valueText: formatSignedNumber(reference),
    contextLabel:
      macd !== null && signal !== null
        ? `MACD ${formatSignedNumber(macd)} vs Signal ${formatSignedNumber(signal)}`
        : 'Using available MACD signal',
    percent: clampPercent(50 + delta * 35),
    numericValue: reference,
  }
}

function resolveAdxInsightWidget(
  rawAdx: number | undefined,
  trendBias: InsightTone,
): InsightWidgetState {
  if (!isFiniteNumber(rawAdx)) {
    return {
      tone: 'neutral',
      valueText: 'N/A',
      contextLabel: 'Trend strength unavailable',
      percent: 50,
      numericValue: null,
    }
  }

  const strengthLabel =
    rawAdx < 20 ? 'Weak trend (<20)' : rawAdx <= 40 ? 'Moderate trend' : 'Strong trend (>40)'

  return {
    tone: rawAdx > 20 ? trendBias : 'neutral',
    valueText: decimalFormatter.format(rawAdx),
    contextLabel: strengthLabel,
    percent: clampPercent((rawAdx / 60) * 100),
    numericValue: rawAdx,
  }
}

function resolveMomentumSignalLabel(
  signal: string | undefined,
  trend: string | undefined,
  score: number,
): { label: 'Strong Bullish' | 'Bullish' | 'Neutral' | 'Bearish'; tone: InsightTone } {
  const combined = `${signal ?? ''} ${trend ?? ''}`.toLowerCase()
  if (combined.includes('strong bullish')) {
    return { label: 'Strong Bullish', tone: 'bullish' }
  }
  if (combined.includes('bull')) {
    return { label: 'Bullish', tone: 'bullish' }
  }
  if (combined.includes('bear')) {
    return { label: 'Bearish', tone: 'bearish' }
  }
  if (score >= 70) {
    return { label: 'Strong Bullish', tone: 'bullish' }
  }
  if (score >= 55) {
    return { label: 'Bullish', tone: 'bullish' }
  }
  if (score < 40) {
    return { label: 'Bearish', tone: 'bearish' }
  }
  return { label: 'Neutral', tone: 'neutral' }
}

function resolveMomentumInsightWidget(input: {
  trend?: string
  signal?: string
  score: number
  close: number | null
  sma20: number | null
  sma50: number | null
  rsi: number | null
  macdTone: InsightTone
}): {
  tone: InsightTone
  valueText: string
  signalLabel: 'Strong Bullish' | 'Bullish' | 'Neutral' | 'Bearish'
  percent: number
} {
  let strengthScore = clampPercent(input.score)

  if (isFiniteNumber(input.close) && isFiniteNumber(input.sma20)) {
    strengthScore += input.close >= input.sma20 ? 8 : -8
  }
  if (isFiniteNumber(input.close) && isFiniteNumber(input.sma50)) {
    strengthScore += input.close >= input.sma50 ? 8 : -8
  }
  if (isFiniteNumber(input.rsi)) {
    if (input.rsi >= 55 && input.rsi <= 70) {
      strengthScore += 6
    } else if (input.rsi < 45) {
      strengthScore -= 6
    }
  }
  if (input.macdTone === 'bullish') {
    strengthScore += 8
  } else if (input.macdTone === 'bearish') {
    strengthScore -= 8
  }

  strengthScore = clampPercent(strengthScore)

  const signalState = resolveMomentumSignalLabel(
    input.signal,
    input.trend,
    strengthScore,
  )

  return {
    tone: signalState.tone,
    valueText: decimalFormatter.format(strengthScore),
    signalLabel: signalState.label,
    percent: strengthScore,
  }
}

type PriceLadderRow = {
  key: string
  label: string
  value: number | null
  kind: PriceLadderKind
  distanceLabel: string
}

type PriceRangeMarker = {
  key: string
  label: string
  kind: PriceLadderKind
  value: number
  position: number
  anchor: 'left' | 'center' | 'right'
  distanceLabel: string
}

type PriceRangeBand = {
  left: number
  width: number
}

function uniqueSortedLevels(levels: number[] | undefined): number[] {
  if (!Array.isArray(levels)) {
    return []
  }

  const unique = new Set<number>()
  for (const level of levels) {
    if (isFiniteNumber(level)) {
      unique.add(level)
    }
  }
  return Array.from(unique).sort((a, b) => a - b)
}

function pickResistanceLevels(
  levels: number[],
  currentPrice: number | null,
): [number | null, number | null] {
  const preferred =
    currentPrice !== null ? levels.filter((level) => level > currentPrice) : levels
  const selected: (number | null)[] = preferred.slice(0, 2)

  while (selected.length < 2) {
    selected.push(null)
  }

  return [selected[0], selected[1]]
}

function pickSupportLevels(
  levels: number[],
  currentPrice: number | null,
): [number | null, number | null] {
  const descending = [...levels].sort((a, b) => b - a)
  const preferred =
    currentPrice !== null
      ? descending.filter((level) => level < currentPrice)
      : descending
  const selected: (number | null)[] = preferred.slice(0, 2)

  while (selected.length < 2) {
    selected.push(null)
  }

  return [selected[0], selected[1]]
}

function levelDistanceLabel(
  kind: PriceLadderKind,
  level: number | null,
  currentPrice: number | null,
): string {
  if (kind === 'current') {
    return '0.0% from current'
  }
  if (!isFiniteNumber(level) || !isFiniteNumber(currentPrice) || currentPrice === 0) {
    return ''
  }

  const absoluteMove = Math.abs(((level - currentPrice) / currentPrice) * 100)
  const sign = kind === 'resistance' ? '+' : '-'
  return `${sign}${absoluteMove.toFixed(1)}% from current`
}

function buildPriceLadderRows(input: {
  currentPrice: number | null
  supports: number[] | undefined
  resistances: number[] | undefined
}): PriceLadderRow[] {
  const resistanceLevels = uniqueSortedLevels(input.resistances)
  const supportLevels = uniqueSortedLevels(input.supports)
  const [resistance1, resistance2] = pickResistanceLevels(
    resistanceLevels,
    input.currentPrice,
  )
  const [support1, support2] = pickSupportLevels(supportLevels, input.currentPrice)

  return [
    {
      key: 'resistance-2',
      label: 'Resistance 2',
      value: resistance2,
      kind: 'resistance',
      distanceLabel: levelDistanceLabel('resistance', resistance2, input.currentPrice),
    },
    {
      key: 'resistance-1',
      label: 'Resistance 1',
      value: resistance1,
      kind: 'resistance',
      distanceLabel: levelDistanceLabel('resistance', resistance1, input.currentPrice),
    },
    {
      key: 'current-price',
      label: 'Current Price',
      value: input.currentPrice,
      kind: 'current',
      distanceLabel: levelDistanceLabel('current', input.currentPrice, input.currentPrice),
    },
    {
      key: 'support-1',
      label: 'Support 1',
      value: support1,
      kind: 'support',
      distanceLabel: levelDistanceLabel('support', support1, input.currentPrice),
    },
    {
      key: 'support-2',
      label: 'Support 2',
      value: support2,
      kind: 'support',
      distanceLabel: levelDistanceLabel('support', support2, input.currentPrice),
    },
  ]
}

function buildPriceRangeMarkers(rows: PriceLadderRow[]): PriceRangeMarker[] {
  const numericRows = rows.filter(
    (row): row is PriceLadderRow & { value: number } => isFiniteNumber(row.value),
  )
  if (numericRows.length === 0) {
    return []
  }

  const min = Math.min(...numericRows.map((row) => row.value))
  const max = Math.max(...numericRows.map((row) => row.value))
  const edgePaddingPercent = 7
  const usableRangePercent = 100 - edgePaddingPercent * 2

  const sorted = [...numericRows].sort((a, b) => a.value - b.value)
  return sorted.map((row) => {
    const normalized =
      max === min
        ? 0.5
        : clampPercent(((row.value - min) / (max - min)) * 100) / 100
    const position = edgePaddingPercent + normalized * usableRangePercent
    const anchor: PriceRangeMarker['anchor'] =
      position <= edgePaddingPercent + 0.5
        ? 'left'
        : position >= 100 - edgePaddingPercent - 0.5
          ? 'right'
          : 'center'

    return {
      key: row.key,
      label: row.label,
      kind: row.kind,
      value: row.value,
      position,
      anchor,
      distanceLabel: row.distanceLabel,
    }
  })
}

function buildPriceRangeBand(
  start: number | null | undefined,
  end: number | null | undefined,
): PriceRangeBand | null {
  if (!isFiniteNumber(start) || !isFiniteNumber(end)) {
    return null
  }
  const left = Math.min(start, end)
  const width = Math.abs(end - start)
  if (width <= 0.2) {
    return null
  }
  return { left, width }
}

function resolvePriceMarkerTooltipDistance(marker: PriceRangeMarker): string {
  if (marker.kind === 'current') {
    return 'At current market price'
  }

  const match = marker.distanceLabel.match(/([+-]?\d+(?:\.\d+)?)%/)
  if (!match) {
    return 'Distance unavailable'
  }

  const distance = Math.abs(Number.parseFloat(match[1])).toFixed(1)
  if (marker.kind === 'support') {
    return `${distance}% below current price`
  }
  if (marker.kind === 'resistance') {
    return `${distance}% above current price`
  }
  return `${distance}% from current price`
}

type MovingAverageAlignment = {
  label: 'Strong Bullish Alignment' | 'Bearish Alignment' | 'Mixed Trend Structure' | 'Neutral Alignment'
  tone: InsightTone
}

function resolveMovingAverageAlignment(input: {
  price: number | null
  sma20: number | null
  sma50: number | null
  sma200: number | null
}): MovingAverageAlignment {
  const { price, sma20, sma50, sma200 } = input

  if (
    isFiniteNumber(price) &&
    isFiniteNumber(sma20) &&
    isFiniteNumber(sma50) &&
    isFiniteNumber(sma200)
  ) {
    if (price > sma20 && sma20 > sma50 && sma50 > sma200) {
      return { label: 'Strong Bullish Alignment', tone: 'bullish' }
    }
    if (price < sma20 && sma20 < sma50 && sma50 < sma200) {
      return { label: 'Bearish Alignment', tone: 'bearish' }
    }
    return { label: 'Mixed Trend Structure', tone: 'neutral' }
  }

  return { label: 'Neutral Alignment', tone: 'neutral' }
}

type VolumeSnapshot = {
  chartData: Array<{ label: string; volume: number }>
  averageVolume: number | null
  currentVolume: number | null
  trend: 'Rising' | 'Stable' | 'Falling'
  trendTone: InsightTone
  recentCloses: number[]
}

type RiskLevel = 'low' | 'moderate' | 'high' | 'unknown'

type RiskMetric = {
  label: string
  value: string
  level: RiskLevel
}

type IndicatorMiniSeriesPoint = {
  index: number
  value: number
  label: string
  timestampLabel: string
}

type IndicatorMiniChart = {
  key: 'rsi' | 'macd-hist' | 'adx' | 'volume'
  title: string
  type: 'line' | 'histogram'
  series: IndicatorMiniSeriesPoint[]
  currentValueLabel: string
  stroke: string
}

function averageNumbers(values: number[]): number | null {
  if (values.length === 0) {
    return null
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function formatVolumeDateLabel(value: string, fallbackIndex: number): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return `${fallbackIndex + 1}`
  }
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatMiniPointTimestamp(value: string, fallbackIndex: number): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return `Point ${fallbackIndex + 1}`
  }
  return parsed.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function resolveVolumeTrend(volumes: number[]): {
  trend: 'Rising' | 'Stable' | 'Falling'
  tone: InsightTone
} {
  if (volumes.length < 6) {
    return { trend: 'Stable', tone: 'neutral' }
  }

  const splitIndex = Math.floor(volumes.length / 2)
  const firstHalfAverage = averageNumbers(volumes.slice(0, splitIndex))
  const secondHalfAverage = averageNumbers(volumes.slice(splitIndex))

  if (
    !isFiniteNumber(firstHalfAverage) ||
    !isFiniteNumber(secondHalfAverage) ||
    firstHalfAverage === 0
  ) {
    return { trend: 'Stable', tone: 'neutral' }
  }

  const changeRatio = (secondHalfAverage - firstHalfAverage) / firstHalfAverage
  if (changeRatio > 0.08) {
    return { trend: 'Rising', tone: 'bullish' }
  }
  if (changeRatio < -0.08) {
    return { trend: 'Falling', tone: 'bearish' }
  }
  return { trend: 'Stable', tone: 'neutral' }
}

function buildVolumeSnapshot(ohlcv: OhlcvPoint[]): VolumeSnapshot {
  const recentRows = ohlcv
    .filter(
      (row) =>
        isFiniteNumber(row.volume) &&
        row.volume >= 0 &&
        isFiniteNumber(row.close),
    )
    .slice(-30)

  const chartData = recentRows.map((row, index) => ({
    label: formatVolumeDateLabel(row.date, index),
    volume: row.volume,
  }))
  const volumes = recentRows.map((row) => row.volume)
  const recentCloses = recentRows.map((row) => row.close)
  const trendState = resolveVolumeTrend(volumes)

  return {
    chartData,
    averageVolume: averageNumbers(volumes),
    currentVolume: volumes.length > 0 ? volumes[volumes.length - 1] : null,
    trend: trendState.trend,
    trendTone: trendState.tone,
    recentCloses,
  }
}

function computeRsiSeries(closes: number[], period = 14): Array<number | null> {
  const output: Array<number | null> = Array(closes.length).fill(null)
  if (closes.length <= period) {
    return output
  }

  let gainSum = 0
  let lossSum = 0
  for (let index = 1; index <= period; index += 1) {
    const delta = closes[index] - closes[index - 1]
    if (delta > 0) {
      gainSum += delta
    } else {
      lossSum += Math.abs(delta)
    }
  }

  let averageGain = gainSum / period
  let averageLoss = lossSum / period
  output[period] =
    averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss)

  for (let index = period + 1; index < closes.length; index += 1) {
    const delta = closes[index] - closes[index - 1]
    const gain = delta > 0 ? delta : 0
    const loss = delta < 0 ? Math.abs(delta) : 0
    averageGain = (averageGain * (period - 1) + gain) / period
    averageLoss = (averageLoss * (period - 1) + loss) / period
    output[index] =
      averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss)
  }

  return output
}

function computeEmaSeries(values: number[], period: number): number[] {
  if (values.length === 0) {
    return []
  }

  const alpha = 2 / (period + 1)
  const result: number[] = [values[0]]
  for (let index = 1; index < values.length; index += 1) {
    const previous = result[index - 1]
    result.push(alpha * values[index] + (1 - alpha) * previous)
  }
  return result
}

function computeMacdHistogramSeries(closes: number[]): number[] {
  if (closes.length === 0) {
    return []
  }
  const ema12 = computeEmaSeries(closes, 12)
  const ema26 = computeEmaSeries(closes, 26)
  const macdLine = closes.map((_, index) => ema12[index] - ema26[index])
  const signalLine = computeEmaSeries(macdLine, 9)
  return macdLine.map((value, index) => value - signalLine[index])
}

function computeAdxSeries(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): Array<number | null> {
  const length = Math.min(highs.length, lows.length, closes.length)
  const output: Array<number | null> = Array(length).fill(null)
  if (length <= period + 1) {
    return output
  }

  const tr: number[] = Array(length).fill(0)
  const plusDm: number[] = Array(length).fill(0)
  const minusDm: number[] = Array(length).fill(0)

  for (let index = 1; index < length; index += 1) {
    const upMove = highs[index] - highs[index - 1]
    const downMove = lows[index - 1] - lows[index]
    plusDm[index] = upMove > downMove && upMove > 0 ? upMove : 0
    minusDm[index] = downMove > upMove && downMove > 0 ? downMove : 0
    tr[index] = Math.max(
      highs[index] - lows[index],
      Math.abs(highs[index] - closes[index - 1]),
      Math.abs(lows[index] - closes[index - 1]),
    )
  }

  let trSmooth = 0
  let plusSmooth = 0
  let minusSmooth = 0
  for (let index = 1; index <= period; index += 1) {
    trSmooth += tr[index]
    plusSmooth += plusDm[index]
    minusSmooth += minusDm[index]
  }

  const dxValues: Array<number | null> = Array(length).fill(null)
  for (let index = period; index < length; index += 1) {
    if (index > period) {
      trSmooth = trSmooth - trSmooth / period + tr[index]
      plusSmooth = plusSmooth - plusSmooth / period + plusDm[index]
      minusSmooth = minusSmooth - minusSmooth / period + minusDm[index]
    }
    if (trSmooth <= 0) {
      continue
    }
    const plusDi = (100 * plusSmooth) / trSmooth
    const minusDi = (100 * minusSmooth) / trSmooth
    const denominator = plusDi + minusDi
    if (denominator <= 0) {
      continue
    }
    dxValues[index] = (100 * Math.abs(plusDi - minusDi)) / denominator
  }

  let previousAdx: number | null = null
  for (let index = period; index < length; index += 1) {
    const dx = dxValues[index]
    if (!isFiniteNumber(dx)) {
      continue
    }
    if (!isFiniteNumber(previousAdx)) {
      previousAdx = dx
    } else {
      previousAdx = ((previousAdx * (period - 1)) + dx) / period
    }
    output[index] = previousAdx
  }

  return output
}

function toMiniSeries(
  values: Array<number | null>,
  rows: OhlcvPoint[],
): IndicatorMiniSeriesPoint[] {
  const points: IndicatorMiniSeriesPoint[] = []
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (isFiniteNumber(value)) {
      const row = rows[index]
      points.push({
        index,
        value,
        label: row ? formatVolumeDateLabel(row.date, index) : `${index + 1}`,
        timestampLabel: row
          ? formatMiniPointTimestamp(row.date, index)
          : `Point ${index + 1}`,
      })
    }
  }
  return points
}

function lastMiniValue(values: Array<number | null>): number | null {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index]
    if (isFiniteNumber(value)) {
      return value
    }
  }
  return null
}

function formatMiniIndicatorValue(
  key: IndicatorMiniChart['key'],
  value: number | null,
): string {
  if (!isFiniteNumber(value)) {
    return 'N/A'
  }
  if (key === 'volume') {
    return compactFormatter.format(value)
  }
  if (key === 'macd-hist') {
    return formatSignedNumber(Number(value.toFixed(2)))
  }
  return value.toFixed(1)
}

function buildIndicatorMiniCharts(ohlcv: OhlcvPoint[]): IndicatorMiniChart[] {
  const recentRows = ohlcv
    .filter(
      (row) =>
        isFiniteNumber(row.close) &&
        isFiniteNumber(row.high) &&
        isFiniteNumber(row.low) &&
        isFiniteNumber(row.volume),
    )
    .slice(-30)

  const closes = recentRows.map((row) => row.close)
  const highs = recentRows.map((row) => row.high)
  const lows = recentRows.map((row) => row.low)
  const volumes = recentRows.map((row) => row.volume)

  const rsiValues = computeRsiSeries(closes, 14)
  const macdHistogramValues = computeMacdHistogramSeries(closes).map((value) =>
    isFiniteNumber(value) ? value : null,
  )
  const adxValues = computeAdxSeries(highs, lows, closes, 14)
  const volumeValues = volumes.map((value) => (isFiniteNumber(value) ? value : null))

  const charts: IndicatorMiniChart[] = [
    {
      key: 'rsi',
      title: 'RSI Trend',
      type: 'line',
      series: toMiniSeries(rsiValues, recentRows),
      currentValueLabel: formatMiniIndicatorValue('rsi', lastMiniValue(rsiValues)),
      stroke: 'var(--chart-blue)',
    },
    {
      key: 'macd-hist',
      title: 'MACD Histogram',
      type: 'histogram',
      series: toMiniSeries(macdHistogramValues, recentRows),
      currentValueLabel: formatMiniIndicatorValue(
        'macd-hist',
        lastMiniValue(macdHistogramValues),
      ),
      stroke: 'var(--chart-teal)',
    },
    {
      key: 'adx',
      title: 'ADX Trend',
      type: 'line',
      series: toMiniSeries(adxValues, recentRows),
      currentValueLabel: formatMiniIndicatorValue('adx', lastMiniValue(adxValues)),
      stroke: 'var(--chart-amber)',
    },
    {
      key: 'volume',
      title: 'Volume Trend',
      type: 'line',
      series: toMiniSeries(volumeValues, recentRows),
      currentValueLabel: formatMiniIndicatorValue('volume', lastMiniValue(volumeValues)),
      stroke: 'var(--chart-teal)',
    },
  ]

  return charts
}

function riskLevelLabel(level: RiskLevel): string {
  if (level === 'low') {
    return 'Low Risk'
  }
  if (level === 'moderate') {
    return 'Moderate'
  }
  if (level === 'high') {
    return 'High Risk'
  }
  return 'Not available'
}

function riskLevelToTone(level: RiskLevel): InsightTone {
  if (level === 'low') {
    return 'bullish'
  }
  if (level === 'high') {
    return 'bearish'
  }
  return 'neutral'
}

function classifyVolatilityRisk(volatility: number | null): RiskLevel {
  if (!isFiniteNumber(volatility)) {
    return 'unknown'
  }
  if (volatility < 20) {
    return 'low'
  }
  if (volatility <= 35) {
    return 'moderate'
  }
  return 'high'
}

function classifyBetaRisk(beta: number | null): RiskLevel {
  if (!isFiniteNumber(beta)) {
    return 'unknown'
  }
  const absoluteBeta = Math.abs(beta)
  if (absoluteBeta < 1) {
    return 'low'
  }
  if (absoluteBeta <= 1.5) {
    return 'moderate'
  }
  return 'high'
}

function classifyDrawdownRisk(maxDrawdown: number | null): RiskLevel {
  if (!isFiniteNumber(maxDrawdown)) {
    return 'unknown'
  }
  const absolute = Math.abs(maxDrawdown)
  if (absolute < 10) {
    return 'low'
  }
  if (absolute <= 20) {
    return 'moderate'
  }
  return 'high'
}

function classifyDistanceRisk(distancePercent: number | null): RiskLevel {
  if (!isFiniteNumber(distancePercent)) {
    return 'unknown'
  }
  if (distancePercent <= 2) {
    return 'high'
  }
  if (distancePercent <= 5) {
    return 'moderate'
  }
  return 'low'
}

function computeVolatility30(recentCloses: number[]): number | null {
  if (recentCloses.length < 2) {
    return null
  }

  const returns: number[] = []
  for (let index = 1; index < recentCloses.length; index += 1) {
    const previous = recentCloses[index - 1]
    const current = recentCloses[index]
    if (!isFiniteNumber(previous) || !isFiniteNumber(current) || previous === 0) {
      continue
    }
    returns.push((current - previous) / previous)
  }

  if (returns.length < 2) {
    return null
  }

  const meanReturn = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance =
    returns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) /
    (returns.length - 1)
  const dailyStd = Math.sqrt(variance)
  return dailyStd * Math.sqrt(252) * 100
}

function computeMaxDrawdown(recentCloses: number[]): number | null {
  if (recentCloses.length === 0) {
    return null
  }

  let peak: number | null = null
  let maxDrawdown = 0

  for (const close of recentCloses) {
    if (!isFiniteNumber(close)) {
      continue
    }
    if (peak === null || close > peak) {
      peak = close
    }
    if (!isFiniteNumber(peak) || peak === 0) {
      continue
    }
    const drawdown = ((close - peak) / peak) * 100
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown
    }
  }

  return maxDrawdown
}

function computeDistancePercent(base: number | null, level: number | null): number | null {
  if (!isFiniteNumber(base) || !isFiniteNumber(level) || base === 0) {
    return null
  }
  return Math.abs(((level - base) / base) * 100)
}

function formatRiskMetricValue(value: number | null, suffix = ''): string {
  if (!isFiniteNumber(value)) {
    return 'N/A'
  }
  return `${value.toFixed(1)}${suffix}`
}

function buildRiskMetrics(input: {
  recentCloses: number[]
  beta: number | null
  currentPrice: number | null
  nearestSupport: number | null
  nearestResistance: number | null
}): RiskMetric[] {
  const volatility = computeVolatility30(input.recentCloses)
  const maxDrawdown = computeMaxDrawdown(input.recentCloses)
  const distanceToSupport = computeDistancePercent(
    input.currentPrice,
    input.nearestSupport,
  )
  const distanceToResistance = computeDistancePercent(
    input.currentPrice,
    input.nearestResistance,
  )

  return [
    {
      label: 'Volatility (30 day)',
      value: formatRiskMetricValue(volatility, '%'),
      level: classifyVolatilityRisk(volatility),
    },
    {
      label: 'Beta',
      value: isFiniteNumber(input.beta) ? input.beta.toFixed(2) : 'N/A',
      level: classifyBetaRisk(input.beta),
    },
    {
      label: 'Max Drawdown',
      value: formatRiskMetricValue(maxDrawdown, '%'),
      level: classifyDrawdownRisk(maxDrawdown),
    },
    {
      label: 'Distance to Support',
      value: formatRiskMetricValue(distanceToSupport, '%'),
      level: classifyDistanceRisk(distanceToSupport),
    },
    {
      label: 'Distance to Resistance',
      value: formatRiskMetricValue(distanceToResistance, '%'),
      level: classifyDistanceRisk(distanceToResistance),
    },
  ]
}

function formatHeadlineTimestamp(value: string | undefined): string {
  if (!value) {
    return 'Unknown time'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return parsed.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

function resolveHeadlineTimestamp(headline: SentimentHeadline): string | undefined {
  if (headline.publishedAt) {
    return headline.publishedAt
  }
  if (headline.published_at) {
    return headline.published_at
  }
  if (headline.pubDate) {
    return headline.pubDate
  }
  if (headline.dateTimePub) {
    return headline.dateTimePub
  }
  if (headline.dateTime) {
    return headline.dateTime
  }
  if (headline.date && headline.time) {
    return `${headline.date}T${headline.time}Z`
  }
  if (headline.date) {
    return headline.date
  }
  return undefined
}

function sentimentSignalTone(value: string | undefined): 'positive' | 'neutral' | 'negative' {
  const normalized = (value ?? '').trim().toLowerCase()
  if (normalized.includes('positive') || normalized.includes('bullish')) {
    return 'positive'
  }
  if (normalized.includes('negative') || normalized.includes('bearish')) {
    return 'negative'
  }
  return 'neutral'
}

function formatHeadlineSentimentLabel(value: string | undefined): string {
  const tone = sentimentSignalTone(value)
  if (tone === 'positive') {
    return 'Positive'
  }
  if (tone === 'negative') {
    return 'Negative'
  }
  return 'Neutral'
}

function formatHeadlineConfidence(value: unknown): string {
  if (!isFiniteNumber(value)) {
    return 'N/A'
  }
  const percent = Math.max(0, Math.min(100, value * 100))
  return `${percent.toFixed(1)}%`
}


function summarizeScore(
  score: number,
  mode: 'fundamental' | 'sentiment',
): string {
  if (mode === 'fundamental') {
    if (score >= 70) {
      return 'Balance sheet strength, profitability, and valuation metrics indicate a strong fundamental setup.'
    }
    if (score >= 45) {
      return 'Core fundamentals are mixed. Some health metrics are solid, while others need confirmation.'
    }
    return 'Fundamental profile is weak relative to preferred thresholds for valuation, growth, or financial health.'
  }

  if (score >= 70) {
    return 'Headline flow is largely constructive with a positive skew across recent coverage.'
  }
  if (score >= 45) {
    return 'News tone is balanced overall, without a dominant positive or negative signal.'
  }
  return 'Recent news flow is skewed negative and may weigh on near-term sentiment.'
}

function extractBulletPoints(raw: string): string[] {
  const text = raw.replace(/\r\n/g, '\n').replace(/\\n/g, '\n').trim()
  if (!text) {
    return []
  }

  // Strict bullet boundary: only ". -", ".-", and line-start "- ".
  const normalizedText = text.replace(/\. ?(?=-\s+\S)/g, '.\n')
  const firstMarkerPattern = /(^|\n)-\s+\S/m
  const firstMarkerMatch = firstMarkerPattern.exec(normalizedText)
  const leadingText = firstMarkerMatch
    ? normalizedText
      .slice(0, firstMarkerMatch.index + (firstMarkerMatch[1]?.length ?? 0))
      .trim()
    : ''

  const lineBulletPattern = /^-\s+(.+)$/
  const bulletsFromLines: string[] = []
  let current = ''

  for (const rawLine of normalizedText.split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }
    const bulletMatch = line.match(lineBulletPattern)
    if (bulletMatch) {
      if (current) {
        bulletsFromLines.push(current)
      }
      current = bulletMatch[1].trim()
      continue
    }
    if (current) {
      current = `${current} ${line}`.trim()
    }
  }

  if (current) {
    bulletsFromLines.push(current)
  }

  if (bulletsFromLines.length > 0) {
    if (leadingText) {
      return [leadingText, ...bulletsFromLines]
    }
    return bulletsFromLines
  }

  const flattened = normalizedText.replace(/\s+/g, ' ').trim()
  if (!flattened.includes('. - ')) {
    return []
  }
  const segments = flattened
    .split(/\. -\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (segments.length <= 1) {
    return []
  }

  return segments
}

function parseSentimentSummary(raw: string): { insights: string[]; summary: string } {
  const text = raw.replace(/\r\n/g, '\n').replace(/\\n/g, '\n').trim()
  if (!text) {
    return { insights: [], summary: '' }
  }

  const summaryLabelPattern =
    /(?:\*\*\s*)?\bsummary\b(?:\s*[:-]\s*)?(?:\s*\*\*)?\s*[:-]?\s*/i
  const summaryLabelMatch = summaryLabelPattern.exec(text)
  let insightsPart = text
  let summaryPart = ''
  if (summaryLabelMatch && typeof summaryLabelMatch.index === 'number') {
    insightsPart = text.slice(0, summaryLabelMatch.index).trim()
    summaryPart = text
      .slice(summaryLabelMatch.index + summaryLabelMatch[0].length)
      .trim()
  }

  const insights = extractBulletPoints(insightsPart)

  const summary = summaryPart.trim()

  if (insights.length === 0 && !summary) {
    return { insights: [], summary: text }
  }

  return { insights, summary }
}

function resolveTechnicalData(
  result: TechnicalResult,
): TechnicalData {
  const legacy = result.data
  const indicators = result.indicators

  return {
    symbol: legacy?.symbol ?? result.symbol ?? '',
    currency: legacy?.currency ?? result.currency,
    ohlcv: legacy?.ohlcv ?? result.ohlcv ?? [],
    lastClose: legacy?.lastClose ?? indicators?.close ?? null,
    sma20: legacy?.sma20 ?? indicators?.SMA20 ?? null,
    sma50: legacy?.sma50 ?? indicators?.SMA50 ?? null,
    rsi: legacy?.rsi ?? indicators?.RSI ?? null,
    ['52WeekLow']: (legacy as any)?.['52WeekLow'] ?? (indicators as any)?.['52WeekLow'] ?? null,
    ['52WeekHigh']:
      (legacy as any)?.['52WeekHigh'] ?? (indicators as any)?.['52WeekHigh'] ?? null,
    structure: result.structure,
  }
}

function describeTechnicalSignal(result: TechnicalResult): string {
  const parts: string[] = []
  if (result.trend) {
    parts.push(`Trend: ${result.trend}.`)
  }
  if (result.signal) {
    parts.push(`Signal: ${result.signal}.`)
  }
  if (result.reasons && result.reasons.length > 0) {
    parts.push(`Drivers: ${result.reasons.slice(0, 3).join(', ')}.`)
  }
  return parts.join(' ')
}

function describeTrend(data: TechnicalData): string {
  const close = data.lastClose
  const sma20 = data.sma20
  const sma50 = data.sma50
  const rsi = data.rsi

  const trendParts: string[] = []
  if (
    typeof close === 'number' &&
    typeof sma20 === 'number' &&
    typeof sma50 === 'number'
  ) {
    if (close > sma20 && close > sma50) {
      trendParts.push('Price is above both SMA20 and SMA50, suggesting upward trend support.')
    } else if (close < sma20 && close < sma50) {
      trendParts.push('Price is below SMA20 and SMA50, indicating weaker trend structure.')
    } else {
      trendParts.push('Price is between moving averages, showing mixed momentum.')
    }
  }

  if (typeof rsi === 'number') {
    if (rsi > 70) {
      trendParts.push('RSI is elevated, which can indicate overbought conditions.')
    } else if (rsi < 30) {
      trendParts.push('RSI is low, which can indicate oversold conditions.')
    } else {
      trendParts.push('RSI is in a balanced range.')
    }
  }

  if (trendParts.length === 0) {
    return 'Technical indicator coverage is limited for this ticker.'
  }

  return trendParts.join(' ')
}

export default App

