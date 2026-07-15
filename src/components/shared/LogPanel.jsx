import React from 'react'

const URL_REGEX = /(https?:\/\/[^\s]+)/g

/**
 * Render a log message with auto-detected URLs as clickable links.
 */
function LogMessage({ msg }) {
  const parts = msg.split(URL_REGEX)
  if (parts.length === 1) {
    return <span className="log-msg">{msg}</span>
  }
  return (
    <span className="log-msg">
      {parts.map((part, i) => {
        if (URL_REGEX.test(part)) {
          return (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="log-link">
              {part.length > 70 ? part.slice(0, 40) + '...' + part.slice(-20) : part} ↗
            </a>
          )
        }
        return part
      })}
    </span>
  )
}

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
            <LogMessage msg={log.msg} />
          </div>
        ))}
      </div>
    </div>
  )
}
