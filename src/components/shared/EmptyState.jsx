import React from 'react'

/**
 * Empty state placeholder.
 * @param {{ icon: string, title: string, message: string, style?: object }} props
 */
export default function EmptyState({ icon = '📭', title, message, style = {} }) {
  return (
    <div style={{ textAlign: 'center', padding: 30, color: '#666', fontStyle: 'italic', ...style }}>
      {icon && <div style={{ fontSize: 32, marginBottom: 8 }}>{icon}</div>}
      {title && <div style={{ fontSize: 13, fontWeight: 600, color: '#999', marginBottom: 4 }}>{title}</div>}
      {message && <div style={{ fontSize: 12, color: '#777' }}>{message}</div>}
    </div>
  )
}
