import React from 'react'

/**
 * Reusable error/warning/info box.
 * @param {{ children: React.ReactNode, type?: 'error'|'warning'|'info'|'success', title?: string, style?: object }} props
 */
const BOX_STYLES = {
  error:   { borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#fca5a5', icon: '✕', iconBg: 'rgba(239,68,68,0.2)' },
  warning: { borderColor: 'rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.06)', color: '#fbbf24', icon: '⚠', iconBg: 'rgba(234,179,8,0.15)' },
  info:    { borderColor: 'rgba(59,130,246,0.2)', background: 'rgba(59,130,246,0.04)', color: '#60a5fa', icon: '💡', iconBg: 'rgba(59,130,246,0.15)' },
  success: { borderColor: 'rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.08)', color: '#22c55e', icon: '✅', iconBg: 'rgba(34,197,94,0.15)' },
}

export default function ErrorBox({ children, type = 'error', title, style = {} }) {
  const s = BOX_STYLES[type] || BOX_STYLES.error
  return (
    <div className="error-box" style={{ ...s, ...style }}>
      <span className="error-icon" style={{ background: s.iconBg, color: s.color }}>{s.icon}</span>
      <div>
        {title && <strong style={{ color: s.color, fontSize: 13, display: 'block', marginBottom: 4 }}>{title}</strong>}
        {typeof children === 'string' ? <span>{children}</span> : children}
      </div>
    </div>
  )
}
