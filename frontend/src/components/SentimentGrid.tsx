import React from 'react'
import type { SentimentResult } from '../types'

interface SentimentGridProps {
  data: SentimentResult | null | undefined
}

export const SentimentGrid: React.FC<SentimentGridProps> = ({ data }) => {
  if (!data) return null

  // Simulate Institutional vs Retail sentiment from the main score (0-100)
  const baseScore = data.score ?? 50
  const instScore = Math.min(100, Math.max(0, baseScore + 6))
  const retailScore = Math.min(100, Math.max(0, baseScore - 4))
  
  const getBullishText = (score: number) => {
    if (score > 60) return 'BULLISH'
    if (score < 40) return 'BEARISH'
    return 'NEUTRAL'
  }

  // Display max 3 headlines as "Signal Cluster"
  const topHeadlines = data.headlines?.slice(0, 3) || []

  return (
    <section className="bg-surface-container-lowest p-5 rounded-md border-none flex flex-col h-full w-full">
      <h4 className="font-label text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-6">
        The Sentiment
      </h4>
      <div className="mb-8">
        <div className="flex justify-between items-end mb-2">
          <span className="font-label text-[10px] uppercase font-bold text-primary">
            Institutional
          </span>
          <span className={`font-label text-lg font-bold ${instScore > 50 ? 'text-secondary' : 'text-error'}`}>
            {Math.round(instScore)}% {getBullishText(instScore)}
          </span>
        </div>
        <div className="h-1.5 w-full bg-surface-container-high rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${instScore > 50 ? 'bg-secondary' : 'bg-error'}`}
            style={{ width: `${instScore}%` }}
          />
        </div>
      </div>

      <div className="mb-8">
        <div className="flex justify-between items-end mb-2">
          <span className="font-label text-[10px] uppercase font-bold text-primary">
            Retail / Social
          </span>
          <span className={`font-label text-lg font-bold ${retailScore > 50 ? 'text-on-tertiary-fixed-variant' : 'text-error'}`}>
            {Math.round(retailScore)}% {getBullishText(retailScore)}
          </span>
        </div>
        <div className="h-1.5 w-full bg-surface-container-high rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${retailScore > 50 ? 'bg-on-tertiary-fixed-variant' : 'bg-error'}`}
            style={{ width: `${retailScore}%` }}
          />
        </div>
      </div>

      <div className="mt-auto">
        <h5 className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant mb-4">
          Signal Cluster
        </h5>
        <div className="space-y-3">
          {topHeadlines.length > 0 ? (
            topHeadlines.map((h, i) => (
              <a
                key={i}
                href={h.link}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 p-2 bg-surface-container-low rounded hover:bg-surface-container-high transition-colors cursor-pointer"
              >
                <span className={`material-symbols-outlined text-sm ${h.sentiment === 'positive' ? 'text-secondary' : h.sentiment === 'negative' ? 'text-error' : 'text-on-tertiary-fixed-variant'}`}>
                  {h.sentiment === 'positive' ? 'trending_up' : h.sentiment === 'negative' ? 'warning' : 'public'}
                </span>
                <span className="font-label text-[11px] font-medium leading-tight text-on-surface-variant line-clamp-2">
                  {h.title}
                </span>
              </a>
            ))
          ) : (
             <div className="text-xs text-on-surface-variant">No signals detected</div>
          )}
        </div>
      </div>
    </section>
  )
}
