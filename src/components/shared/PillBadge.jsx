import React from 'react'

/**
 * Small colored pill badge. Variants: 'default', 'blue', 'green', 'yellow', 'purple', 'red'.
 * @param {{ children: React.ReactNode, variant?: string, style?: object }} props
 */
const PILL_COLORS = {
  default: { bg: 'rgba(255,255,255,0.06)', color: '#94a3b8' },
  blue:    { bg: 'rgba(59,130,246,0.1)',  color: '#60a5fa' },
  green:   { bg: 'rgba(34,197,94,0.1)',   color: '#22c55e' },
  yellow:  { bg: 'rgba(234,179,8,0.1)',   color: '#eab308' },
  purple:  { bg: 'rgba(168,85,247,0.1)',  color: '#a78bfa' },
  red:     { bg: 'rgba(239,68,68,0.1)',   color: '#ef4444' },
}

export default function PillBadge({ children, variant = 'default', style = {} }) {
  const c = PILL_COLORS[variant] || PILL_COLORS.default
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600,
      background: c.bg, color: c.color,
      ...style,
    }}>
      {children}
    </span>
  )
}
