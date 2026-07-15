import React from 'react'

/**
 * Reusable stats bar. Each stat: { label, value, color }
 * @param {{ stats: Array<{label: string, value: React.ReactNode, color?: string}> }} props
 */
export default function StatsBar({ stats = [] }) {
  if (stats.length === 0) return null

  return (
    <div className="stats-bar">
      {stats.map((s, i) => (
        <div className="stat" key={i}>
          <span className="stat-label">{s.label}</span>
          <span className="stat-value" style={s.color ? { color: s.color } : {}}>
            {s.value}
          </span>
        </div>
      ))}
    </div>
  )
}
