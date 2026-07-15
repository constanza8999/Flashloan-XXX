import React from 'react'

/**
 * Reusable config/result panel wrapper with optional title and header actions.
 * @param {{ title?: string, children: React.ReactNode, headerRight?: React.ReactNode, className?: string, style?: object }} props
 */
export default function ConfigPanel({ title, children, headerRight, className = '', style = {} }) {
  return (
    <div className={`config-panel ${className}`} style={style}>
      {(title || headerRight) && (
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', marginBottom: 16,
        }}>
          {title && <h3 style={{ margin: 0, padding: 0, border: 'none' }}>{title}</h3>}
          {headerRight && <div style={{ display: 'flex', gap: 8 }}>{headerRight}</div>}
        </div>
      )}
      {children}
    </div>
  )
}
