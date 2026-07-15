import React from 'react'

/**
 * Reusable result display panel with success/dry-run variants.
 * @param {{ children: React.ReactNode, type?: 'success'|'dry-run', title: string, style?: object }} props
 */
export default function ResultPanel({ children, type = 'success', title, style = {} }) {
  return (
    <div className={`result-panel ${type}`} style={style}>
      {title && <h3>{title}</h3>}
      {children}
    </div>
  )
}
