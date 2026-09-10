export type NullableScore = number | null
export type AuthMode = 'login' | 'signup'

export interface AuthUser {
  id: number
  username: string
  email: string
}

export interface OverviewData {
  fundamentalScore: NullableScore
  technicalScore: NullableScore
  sentimentScore: NullableScore
  overallScore: number
  predictedScore: number | null
  verdict: string
}

export interface FundamentalData {
  symbol?: string
  shortName?: string
  longName?: string
  sector?: string
  industry?: string
  exchange?: string
  fullExchangeName?: string
  website?: string
  description?: string
  currentPrice?: number
  currency?: string
  marketCap?: number
  enterpriseValue?: number
  beta?: number
  trailingPE?: number
  forwardPE?: number
  pegRatio?: number
  priceToBook?: number
  trailingEps?: number
  returnOnEquity?: number
  returnOnAssets?: number
  operatingMargins?: number
  profitMargins?: number
  debtToEquity?: number
  currentRatio?: number
  revenueGrowth?: number
  earningsGrowth?: number
  dividendYield?: number
  ['52WeekHigh']?: number
  ['52WeekLow']?: number
  enterpriseToEbitda?: number
  returnOnCapitalEmployed?: number
  interestCoverage?: number
  priceToSalesTrailing12Months?: number
  quickRatio?: number
  grossMargins?: number
  totalCash?: number
  totalDebt?: number
  payoutRatio?: number
  targetMeanPrice?: number
  recommendationKey?: string
  numberOfAnalystOpinions?: number
  revenueTrend?: Array<{ year: number; revenue: number | null; netProfit: number | null }>
  marginsTrend?: Array<{ year: number; operatingMargin: number | null; netMargin: number | null }>
  cashflowTrend?: Array<{ year: number; operatingCashFlow: number | null; freeCashFlow: number | null }>
  shareholdingPattern?: {
    promoters: number
    institutions: number
    public: number
  }
  sectorPeersAnalysis?: {
    peers: string[]
    trailing: {
      rawValue: number | null
      sectorMean: number | null
      relativeStandingScore: number | null
      relativeStandingLabel: string
    }
    forward: {
      rawValue: number | null
      sectorMean: number | null
      relativeStandingScore: number | null
      relativeStandingLabel: string
    }
  }
}

export interface FundamentalResult {
  data: FundamentalData
  score: number
}

export interface OhlcvPoint {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface TechnicalData {
  symbol: string
  currency?: string
  ohlcv: OhlcvPoint[]
  lastClose: number | null
  sma20: number | null
  sma50: number | null
  rsi: number | null
  ['52WeekLow']: number | null
  ['52WeekHigh']: number | null
  structure?: TechnicalStructure
}

export interface TechnicalIndicators {
  close?: number
  RSI?: number
  MACD?: number
  MACD_signal?: number
  ADX?: number
  ATR?: number
  SMA20?: number
  SMA50?: number
  SMA200?: number
  ['52WeekLow']?: number
  ['52WeekHigh']?: number
  [key: string]: any
}

export interface TechnicalStructure {
  support?: number[]
  resistance?: number[]
  breakout?: string | null
  volumeSpike?: boolean
  fibonacciLevels?: Record<string, number>
}

export interface TechnicalResult {
  score: number
  data?: TechnicalData
  symbol?: string
  currency?: string
  trend?: string
  signal?: string
  regime?: string
  reasons?: string[]
  indicators?: TechnicalIndicators
  structure?: TechnicalStructure
  ohlcv?: OhlcvPoint[]
}

export interface SentimentHeadline {
  title: string
  link: string
  source: string
  apiSource?: string
  publishedAt?: string
  published_at?: string
  pubDate?: string
  dateTimePub?: string
  dateTime?: string
  date?: string
  time?: string
  sentiment: string
  sentimentScore: number
}

export interface SentimentData {
  symbol: string
  count: number
}

export interface SentimentResult {
  data: SentimentData
  headlines: SentimentHeadline[]
  score: number
}

export interface ReportSections {
  overall: string
  fundamental: string
  technical: string
  sentiment: string
  riskFactors: string
  conclusion: string
  disclaimer: string
}

export interface AnalysisResponse {
  ticker: string
  overview: OverviewData
  fundamental: FundamentalResult | null
  technical: TechnicalResult | null
  sentiment: SentimentResult | null
  report?: string
  reportSections?: Partial<ReportSections>
  reportSource?: string
  error?: string
}

export interface SearchSuggestion {
  ticker: string
  name: string
  exchange?: string
  type?: string
}

export interface ComparisonResponse {
  results: Record<string, AnalysisResponse | { error: string }>
}

// ─── Discussion Portal Types ───────────────────────────────────────────

export interface DiscussionAuthor {
  id: number
  username: string
}

export interface DiscussionReply {
  id: number
  postId: number
  parentId: number | null
  author: DiscussionAuthor
  body: string
  createdAt: string
  updatedAt: string
  upvotes: number
  downvotes: number
  userVote: number // +1, -1, or 0
  children: DiscussionReply[]
}

export interface DiscussionPost {
  id: number
  ticker: string
  author: DiscussionAuthor
  title: string
  body: string
  createdAt: string
  updatedAt: string
  upvotes: number
  downvotes: number
  userVote: number
  replyCount: number
  replies?: DiscussionReply[]
}

export interface DiscussionListResponse {
  ticker: string
  posts: DiscussionPost[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface VoteResponse {
  upvotes: number
  downvotes: number
  userVote: number
  removed?: boolean
}
