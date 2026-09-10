import React, { useMemo, useState } from 'react'
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  YAxis,
  XAxis,
  Tooltip,
} from 'recharts'
import type { TechnicalResult } from '../types'

interface MomentumChartProps {
  data: TechnicalResult | null | undefined
}

export const MomentumChart: React.FC<MomentumChartProps> = ({ data }) => {
  const [duration, setDuration] = useState('1M')

  const chartData = useMemo(() => {
    if (!data?.ohlcv) return []
    // very basic duration filter simulation
    let sliced = data.ohlcv
    if (duration === '1W') sliced = sliced.slice(-5)
    else if (duration === '1M') sliced = sliced.slice(-21)
    else if (duration === '1Y') sliced = sliced.slice(-252)
    return sliced
  }, [data, duration])

  const rsi = data?.indicators?.RSI?.toFixed(1) ?? 'N/A'
  const macd = data?.indicators?.MACD?.toFixed(2) ?? 'N/A'
  const volatility = data?.indicators?.ATR ? data?.indicators?.ATR.toFixed(2) : 'N/A'
  
  // just pick the last volume as an example
  const lastVolumeRaw = data?.ohlcv?.[data.ohlcv.length - 1]?.volume
  const volume = lastVolumeRaw
    ? lastVolumeRaw > 1000000 
      ? (lastVolumeRaw / 1000000).toFixed(1) + 'M' 
      : lastVolumeRaw.toLocaleString()
    : 'N/A'
    
  const high = data?.indicators?.['52WeekHigh']?.toFixed(2) ?? 'N/A'

  return (
    <section className="bg-surface-container-lowest p-6 rounded-md border-none min-h-[450px] flex flex-col w-full">
      <div className="flex justify-between items-center mb-6">
        <h4 className="font-label text-xs font-bold uppercase tracking-widest text-on-surface-variant">
          The Momentum
        </h4>
        <div className="flex bg-surface-container-high p-0.5 rounded-lg overflow-hidden">
          {['1D', '1W', '1M', '1Y', 'ALL'].map((d) => (
            <button
              key={d}
              onClick={() => setDuration(d)}
              className={`px-3 py-1 text-[10px] font-bold rounded-md uppercase ${
                duration === d
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-on-surface-variant'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 relative border-l border-b border-outline-variant/30 ml-4 mb-4 min-h-[250px]">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 0, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#091426" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#091426" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" hide />
              <YAxis domain={['auto', 'auto']} hide />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--color-surface)', borderRadius: 8 }}
                itemStyle={{ color: 'var(--color-primary)' }}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke="#091426"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorClose)"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-on-surface-variant">
            No chart data available
          </div>
        )}

        <div className="absolute top-4 right-4 bg-surface-container-lowest shadow-lg px-3 py-2 rounded border-l-4 border-secondary">
          <p className="font-label text-[9px] uppercase text-on-surface-variant">52W High</p>
          <p className="font-label text-sm font-bold text-primary">{high}</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mt-2">
        <div className="p-3 bg-surface-container-low rounded">
          <p className="font-label text-[9px] uppercase text-on-surface-variant mb-1">RSI</p>
          <p className="font-label text-sm font-bold text-primary">{rsi}</p>
        </div>
        <div className="p-3 bg-surface-container-low rounded">
          <p className="font-label text-[9px] uppercase text-on-surface-variant mb-1">MACD</p>
          <p className="font-label text-sm font-bold text-on-tertiary-fixed-variant">{macd}</p>
        </div>
        <div className="p-3 bg-surface-container-low rounded">
          <p className="font-label text-[9px] uppercase text-on-surface-variant mb-1">Volume</p>
          <p className="font-label text-sm font-bold text-primary">{volume}</p>
        </div>
        <div className="p-3 bg-surface-container-low rounded">
          <p className="font-label text-[9px] uppercase text-on-surface-variant mb-1">Volatility</p>
          <p className="font-label text-sm font-bold text-primary">{volatility}</p>
        </div>
      </div>
    </section>
  )
}
