import React from 'react'

/**
 * Live network connection indicator with pulsing dot.
 * @param {{ networkName: string, blockNumber: number, extra?: string, connected?: boolean, error?: string }} props
 */
export default function NetworkStatus({ networkName, blockNumber, extra, connected = true, error }) {
  if (!connected || error) {
    return (
      <div className="error-box" style={{ marginBottom: 16 }}>
        <span className="error-icon">⚠</span>
        {error || `No RPC connection. Check your network.`}
      </div>
    )
  }

  return (
    <div className="live-indicator" style={{ marginBottom: 16 }}>
      <span className="live-dot"></span>
      <span>{networkName} — Block #{blockNumber}</span>
      {extra && <span className="live-count">{extra}</span>}
    </div>
  )
}
