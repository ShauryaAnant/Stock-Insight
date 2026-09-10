import React from 'react'
import type { FundamentalData } from '../types'

interface PulseGridProps {
  data: FundamentalData | null | undefined
}

const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
})

export const PulseGrid: React.FC<PulseGridProps> = ({ data }) => {
  if (!data) return null

  // Extract from data
  const marketCap = data.marketCap ? compactFormatter.format(data.marketCap) : 'N/A'
  const peRatio = data.trailingPE?.toFixed(2) || 'N/A'
  const evEbitda = data.enterpriseToEbitda?.toFixed(2) || 'N/A'
  const beta = data.beta?.toFixed(2) || 'N/A'
  const divYield = data.dividendYield ? `${(data.dividendYield * 100).toFixed(2)}%` : 'N/A'

  return (
    <div className="flex flex-col gap-6 w-full">
      <section className="bg-surface-container-lowest p-5 rounded-md border-none">
        <h4 className="font-label text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-6">
          The Pulse
        </h4>
        <div className="space-y-5">
          <div>
            <p className="font-label text-[10px] text-on-surface-variant uppercase mb-1">
              Market Cap
            </p>
            <p className="font-label text-lg font-bold text-primary">{marketCap}</p>
          </div>
          <div>
            <p className="font-label text-[10px] text-on-surface-variant uppercase mb-1">
              P/E Ratio (Trailing)
            </p>
            <p className="font-label text-lg font-bold text-primary">{peRatio}</p>
          </div>
          <div>
            <p className="font-label text-[10px] text-on-surface-variant uppercase mb-1">
              EV/EBITDA
            </p>
            <p className="font-label text-lg font-bold text-primary">{evEbitda}</p>
          </div>
          <div>
            <p className="font-label text-[10px] text-on-surface-variant uppercase mb-1">
              Beta (5Y)
            </p>
            <p className="font-label text-lg font-bold text-primary">{beta}</p>
          </div>
          <div>
            <p className="font-label text-[10px] text-on-surface-variant uppercase mb-1">
              Div Yield
            </p>
            <p className="font-label text-lg font-bold text-primary">{divYield}</p>
          </div>
        </div>
      </section>

      <section className="bg-surface-container-low p-5 rounded-md border-none">
        <h4 className="font-label text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-4">
          Earnings Velocity
        </h4>
        <div className="h-32 w-full flex items-end gap-1.5">
          <div className="bg-primary/20 w-full h-[40%] rounded-t-sm"></div>
          <div className="bg-primary/30 w-full h-[55%] rounded-t-sm"></div>
          <div className="bg-primary/50 w-full h-[70%] rounded-t-sm"></div>
          <div className="bg-primary w-full h-[95%] rounded-t-sm"></div>
        </div>
        <p className="font-label text-[10px] text-center mt-3 text-on-surface-variant uppercase tracking-tighter">
          Q3-Q2-Q1-Current
        </p>
      </section>
    </div>
  )
}
