import type { AnalysisResponse, AuthUser, ComparisonResponse, DiscussionListResponse, DiscussionPost, DiscussionReply, OhlcvPoint, ReportSections, SearchSuggestion, VoteResponse } from './types'

// const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(
//   /\/$/,
//   '',
// ) || 'http://20.219.136.14:8000';

// const apiBaseUrl = 'http://20.219.136.14:80';

// Grab the URL from Vercel's environment variables.
// Make sure your Vercel variable is named EXACTLY VITE_API_BASE_URL
const envApiUrl = import.meta.env.VITE_API_BASE_URL;

// If the environment variable exists (like on Vercel), use it.
// If it doesn't exist (like when you run 'npm run dev' locally), fall back to localhost.
export const apiBaseUrl = envApiUrl ? envApiUrl : "http://localhost:8000";

const inFlightAnalysisRequests = new Map<string, Promise<AnalysisResponse>>()
const inFlightReportRequests = new Map<string, Promise<ReportBundleResponse>>()
const inFlightSearchRequests = new Map<string, Promise<SearchSuggestion[]>>()
const searchSuggestionCache = new Map<string, SearchSuggestion[]>()
type AnalysisCacheEntry = {
  data: AnalysisResponse
  cachedAt: number
}

// Change this value to adjust how long analysis responses stay cached.
const ANALYSIS_CACHE_TTL_MS = 60_000
const analysisCache = new Map<string, AnalysisCacheEntry>()
let csrfTokenCache = ''

export function setAnalysisCache(ticker: string, data: AnalysisResponse) {
  analysisCache.set(ticker.trim().toUpperCase(), {
    data,
    cachedAt: Date.now(),
  })
}

function getCachedAnalysisIfFresh(ticker: string): AnalysisResponse | null {
  const cacheEntry = analysisCache.get(ticker)
  if (!cacheEntry) {
    return null
  }

  if (Date.now() - cacheEntry.cachedAt > ANALYSIS_CACHE_TTL_MS) {
    analysisCache.delete(ticker)
    return null
  }

  return cacheEntry.data
}

function apiUrl(path: string): string {
  if (apiBaseUrl) {
    return `${apiBaseUrl}${path}`
  }
  return path
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return {}
  }

  try {
    return (await response.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function ensureCsrfToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && csrfTokenCache) {
    return csrfTokenCache
  }

  const response = await fetch(apiUrl('/api/auth/csrf'), {
    credentials: 'include',
  })
  const payload = await readJson(response)
  const token = typeof payload.csrfToken === 'string' ? payload.csrfToken : ''

  if (!response.ok || !token) {
    throw new Error('Unable to initialize secure session.')
  }

  csrfTokenCache = token
  return token
}

async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('X-CSRFToken', await ensureCsrfToken())
  }

  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers,
  })

  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string' ? payload.error : 'Request failed.',
    )
  }

  return payload as T
}

type AuthEnvelope = {
  user: AuthUser
}

type GoogleAuthEnvelope =
  | {
      requiresCompletion: true
      email: string
      suggestedUsername: string
    }
  | {
      requiresCompletion?: false
      user: AuthUser
    }

type CurrentUserEnvelope = {
  authenticated: boolean
  user: AuthUser | null
}

export type GoogleAuthResult =
  | {
      status: 'needs_completion'
      email: string
      suggestedUsername: string
    }
  | {
      status: 'authenticated'
      user: AuthUser
    }

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const payload = await apiRequest<CurrentUserEnvelope>('/api/auth/me')
  return payload.authenticated ? payload.user : null
}

export async function loginUser(
  identifier: string,
  password: string,
): Promise<AuthUser> {
  const payload = await apiRequest<AuthEnvelope>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  })
  return payload.user
}

export async function registerUser(input: {
  username: string
  email: string
  password: string
  confirmPassword: string
}): Promise<AuthUser> {
  const payload = await apiRequest<AuthEnvelope>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return payload.user
}

export async function loginWithGoogle(
  credential: string,
  mode: 'login' | 'signup',
): Promise<GoogleAuthResult> {
  const payload = await apiRequest<GoogleAuthEnvelope>('/api/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential, mode }),
  })
  if (payload.requiresCompletion) {
    return {
      status: 'needs_completion',
      email: payload.email,
      suggestedUsername: payload.suggestedUsername,
    }
  }
  return {
    status: 'authenticated',
    user: payload.user,
  }
}

export async function completeGoogleSignup(input: {
  username: string
  password: string
  confirmPassword: string
}): Promise<AuthUser> {
  const payload = await apiRequest<AuthEnvelope>('/api/auth/google/complete', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return payload.user
}

export async function logoutUser(): Promise<void> {
  await apiRequest('/api/auth/logout', {
    method: 'POST',
  })
  csrfTokenCache = ''
}

export async function changeUserPassword(input: {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}): Promise<void> {
  await apiRequest('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function fetchAnalysis(
  ticker: string,
): Promise<AnalysisResponse> {
  const cleanTicker = ticker.trim().toUpperCase()

  const cached = getCachedAnalysisIfFresh(cleanTicker)
  if (cached) {
    return cached
  }

  const requestKey = cleanTicker
  const existingRequest = inFlightAnalysisRequests.get(requestKey)
  if (existingRequest) {
    return existingRequest
  }

  const requestPromise = (async () => {
    return apiRequest<AnalysisResponse>(
      `/api/analysis/${encodeURIComponent(cleanTicker)}?include_report=false`,
    )
  })()

  inFlightAnalysisRequests.set(requestKey, requestPromise)
  try {
    const result = await requestPromise
    setAnalysisCache(cleanTicker, result)
    return result
  } finally {
    inFlightAnalysisRequests.delete(requestKey)
  }
}

export interface ReportBundleResponse {
  source: string
  fullReport: string
  sections: import('./types').ReportSections
}

function hasCompleteReportSections(
  sections: Partial<ReportSections> | null | undefined,
): sections is ReportSections {
  return Boolean(
    sections?.overall?.trim() &&
      sections.fundamental?.trim() &&
      sections.technical?.trim() &&
      sections.sentiment?.trim(),
  )
}

export async function fetchAnalysisReport(
  ticker: string,
  analysisData: Omit<AnalysisResponse, 'ticker' | 'report' | 'reportSections' | 'reportSource' | 'error'>
): Promise<ReportBundleResponse> {
  const cleanTicker = ticker.trim().toUpperCase()
  const existingRequest = inFlightReportRequests.get(cleanTicker)
  if (existingRequest) {
    return existingRequest
  }

  const requestPromise = apiRequest<ReportBundleResponse>('/api/analysis/report', {
    method: 'POST',
    body: JSON.stringify({
      ticker: cleanTicker,
      fundamental_result: analysisData.fundamental,
      technical_result: analysisData.technical,
      sentiment_result: analysisData.sentiment,
      overall_score: analysisData.overview.overallScore,
      verdict: analysisData.overview.verdict,
    })
  })

  inFlightReportRequests.set(cleanTicker, requestPromise)
  try {
    return await requestPromise
  } finally {
    inFlightReportRequests.delete(cleanTicker)
  }
}

export async function downloadAnalysisPdf(
  analysis: AnalysisResponse,
): Promise<Blob> {
  const cleanTicker = analysis.ticker.trim().toUpperCase()
  let pdfAnalysis: AnalysisResponse = {
    ...analysis,
    ticker: cleanTicker,
  }

  if (!hasCompleteReportSections(pdfAnalysis.reportSections)) {
    const reportPayload = await fetchAnalysisReport(cleanTicker, pdfAnalysis)
    pdfAnalysis = {
      ...pdfAnalysis,
      report: reportPayload.fullReport,
      reportSections: reportPayload.sections,
      reportSource: reportPayload.source,
    }
    setAnalysisCache(cleanTicker, pdfAnalysis)
  }

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 90_000)
  let primaryErrorMessage = ''

  const parseError = async (response: Response, fallback: string): Promise<string> => {
    const payload = await readJson(response)
    return typeof payload.error === 'string' ? payload.error : fallback
  }

  const postPayloadPdf = async (path: string, csrfToken: string): Promise<Response> =>
    fetch(apiUrl(path), {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken,
      },
      body: JSON.stringify({
        ...pdfAnalysis,
        ticker: cleanTicker,
      }),
    })

  try {
    let csrfToken = ''
    try {
      csrfToken = await ensureCsrfToken()
    } catch (error) {
      primaryErrorMessage =
        error instanceof Error ? error.message : 'Unable to initialize secure session.'
    }

    if (csrfToken) {
      for (const path of ['/api/analysis/generate-pdf', '/api/analysis/pdf']) {
        const response = await postPayloadPdf(path, csrfToken)
        if (response.ok) {
          return response.blob()
        }

        const errorMessage = await parseError(response, 'Failed to generate PDF report.')
        if (!primaryErrorMessage) {
          primaryErrorMessage = errorMessage
        }
      }
    }

    // Demo safety fallback: legacy endpoint may rerun analysis, but avoids broken UX.
    const legacyResponse = await fetch(
      apiUrl(`/api/analysis/${encodeURIComponent(cleanTicker)}/pdf?include_report=false`),
      {
        credentials: 'include',
        signal: controller.signal,
      },
    )
    if (legacyResponse.ok) {
      return legacyResponse.blob()
    }

    const legacyError = await parseError(
      legacyResponse,
      primaryErrorMessage || 'Failed to generate PDF report.',
    )
    throw new Error(legacyError || primaryErrorMessage || 'Failed to generate PDF report.')
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('PDF generation timed out. Please try again.')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function fetchChartData(
  ticker: string,
  duration: string,
): Promise<{ ohlcv: OhlcvPoint[]; currency?: string }> {
  return apiRequest<{ ohlcv: OhlcvPoint[]; currency?: string }>(
    `/api/analysis/chart/${encodeURIComponent(ticker.trim().toUpperCase())}?duration=${encodeURIComponent(duration)}`,
  )
}

export async function fetchSearchSuggestions(
  query: string,
  limit = 8,
  signal?: AbortSignal,
): Promise<SearchSuggestion[]> {
  const cleanQuery = query.trim()
  if (!cleanQuery) {
    return []
  }

  const requestKey = `${cleanQuery.toLowerCase()}::${limit}`
  if (!signal) {
    const cached = searchSuggestionCache.get(requestKey)
    if (cached) {
      return cached
    }

    const existingRequest = inFlightSearchRequests.get(requestKey)
    if (existingRequest) {
      return existingRequest
    }
  }

  const requestPromise = (async () => {
    const payload = await apiRequest<{
      suggestions?: SearchSuggestion[]
    }>(
      `/api/search?q=${encodeURIComponent(cleanQuery)}&limit=${encodeURIComponent(String(limit))}`,
      { signal },
    )

    return Array.isArray(payload.suggestions) ? payload.suggestions : []
  })()

  if (!signal) {
    inFlightSearchRequests.set(requestKey, requestPromise)
  }

  try {
    const suggestions = await requestPromise
    if (!signal) {
      searchSuggestionCache.set(requestKey, suggestions)
    }
    return suggestions
  } finally {
    if (!signal) {
      inFlightSearchRequests.delete(requestKey)
    }
  }
}

export async function fetchComparisonAnalysis(
  tickers: string[],
): Promise<ComparisonResponse> {
  const cleanTickers = Array.from(new Set(tickers
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)))

  const mergedResults: ComparisonResponse['results'] = {}
  const toFetch: string[] = []

  for (const ticker of cleanTickers) {
    const cachedEntry = getCachedAnalysisIfFresh(ticker)
    if (cachedEntry) {
      mergedResults[ticker] = cachedEntry
      continue
    }

    toFetch.push(ticker)
  }

  if (toFetch.length > 0) {
    const response = await apiRequest<ComparisonResponse>('/api/analysis/compare', {
      method: 'POST',
      body: JSON.stringify({ tickers: toFetch }),
    })

    for (const [ticker, result] of Object.entries(response.results)) {
      mergedResults[ticker] = result
      if (result && typeof result === 'object' && !('error' in result)) {
        setAnalysisCache(ticker, result as AnalysisResponse)
      }
    }
  }

  return { results: mergedResults }
}

export async function fetchComparisonReport(
  tickers: string[],
  results: Record<string, unknown>
): Promise<{ report: string }> {
  return apiRequest<{ report: string }>('/api/analysis/compare-report', {
    method: 'POST',
    body: JSON.stringify({ tickers, results }),
  })
}

// ─── Discussion Portal API ─────────────────────────────────────────────

export async function fetchDiscussions(
  ticker: string,
  page = 1,
  sort: 'newest' | 'top' = 'newest',
): Promise<DiscussionListResponse> {
  const cleanTicker = ticker.trim().toUpperCase()
  return apiRequest<DiscussionListResponse>(
    `/api/discussions/${encodeURIComponent(cleanTicker)}?page=${page}&sort=${sort}`,
  )
}

export async function createDiscussionPost(
  ticker: string,
  title: string,
  body: string,
): Promise<DiscussionPost> {
  const cleanTicker = ticker.trim().toUpperCase()
  return apiRequest<DiscussionPost>(
    `/api/discussions/${encodeURIComponent(cleanTicker)}`,
    {
      method: 'POST',
      body: JSON.stringify({ title, body }),
    },
  )
}

export async function fetchDiscussionThread(
  ticker: string,
  postId: number,
): Promise<DiscussionPost> {
  const cleanTicker = ticker.trim().toUpperCase()
  return apiRequest<DiscussionPost>(
    `/api/discussions/${encodeURIComponent(cleanTicker)}/${postId}`,
  )
}

export async function createDiscussionReply(
  ticker: string,
  postId: number,
  body: string,
  parentReplyId?: number,
): Promise<DiscussionReply> {
  const cleanTicker = ticker.trim().toUpperCase()
  return apiRequest<DiscussionReply>(
    `/api/discussions/${encodeURIComponent(cleanTicker)}/${postId}/reply`,
    {
      method: 'POST',
      body: JSON.stringify({
        body,
        parent_reply_id: parentReplyId ?? null,
      }),
    },
  )
}

export async function voteDiscussion(
  postId?: number,
  replyId?: number,
  value: 1 | -1 = 1,
): Promise<VoteResponse> {
  return apiRequest<VoteResponse>('/api/discussions/vote', {
    method: 'POST',
    body: JSON.stringify({
      post_id: postId ?? null,
      reply_id: replyId ?? null,
      value,
    }),
  })
}

export async function deleteDiscussionPost(
  ticker: string,
  postId: number,
): Promise<{ success: boolean }> {
  const cleanTicker = ticker.trim().toUpperCase()
  return apiRequest<{ success: boolean }>(
    `/api/discussions/${encodeURIComponent(cleanTicker)}/${postId}`,
    { method: 'DELETE' },
  )
}

export async function deleteDiscussionReply(
  replyId: number,
): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(
    `/api/discussions/reply/${replyId}`,
    { method: 'DELETE' },
  )
}
