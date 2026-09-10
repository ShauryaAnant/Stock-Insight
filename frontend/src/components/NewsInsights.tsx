import React from 'react'
import type { SentimentHeadline } from '../types'

interface NewsInsightsProps {
  headlines: SentimentHeadline[] | undefined
}

export const NewsInsights: React.FC<NewsInsightsProps> = ({ headlines }) => {
  if (!headlines || headlines.length === 0) return null

  // Use up to 4 headlines for the grid
  const displayHeadlines = headlines.slice(0, 4)

  return (
    <footer className="mt-12 w-full">
      <div className="flex items-center justify-between border-b border-outline-variant/15 pb-2 mb-6">
        <h4 className="font-label text-xs font-bold uppercase tracking-widest text-on-surface-variant">
          Relevant Insights
        </h4>
        <span className="font-label text-[10px] text-secondary font-bold cursor-pointer hover:underline">
          VIEW ALL
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {displayHeadlines.map((h, i) => {
          // Use format for time/source
          const timeLabel = h.publishedAt || h.date || h.time || 'Recent'
          const source = h.source || h.apiSource || 'Market News'

          return (
            <a
              key={i}
              href={h.link}
              target="_blank"
              rel="noreferrer"
              className="group cursor-pointer block"
            >
              <div className="overflow-hidden rounded-lg mb-3 bg-surface-container-high h-24 flex items-center justify-center">
                 <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 group-hover:scale-110 transition-transform duration-500">
                   feed
                 </span>
              </div>
              <p className="font-label text-[9px] text-on-tertiary-fixed-variant font-bold mb-1 uppercase tracking-tighter">
                {source} • {timeLabel}
              </p>
              <h5 className="font-headline text-sm font-bold leading-tight group-hover:text-secondary transition-colors line-clamp-3">
                {h.title}
              </h5>
            </a>
          )
        })}
      </div>
    </footer>
  )
}
