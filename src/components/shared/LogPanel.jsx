import React from 'react'

/**
 * Reusable activity log panel with time-stamped entries.
 * @param {{ logs: Array<{time: string, msg: string, type: string}>, title?: string, maxHeight?: number }} props
 */
export default function LogPanel({ logs, title = '📋 Activity Log', maxHeight = 400 }) {
  if (!logs || logs.length === 0) return null

  return (
    <div className="log-panel">
      <h3>{title}</h3>
      <div className="log-container" style={{ maxHeight }}>
        {logs.map((log, i) => (
          <div key={i} className={`log-entry ${log.type}`}>
            <span className="log-time">{log.time}</span>
            <span className="log-msg">{log.msg}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
