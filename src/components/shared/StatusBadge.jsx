import React from 'react'

/**
 * Reusable status badge — confirmed/failed/pending/broadcast.
 * @param {{ status: string }} props
 */
export default function StatusBadge({ status }) {
  if (status === 'confirmed' || status === 'success') {
    return <span className="th-status confirmed">Confirmed</span>
  }
  if (status === 'failed' || status === 'error') {
    return <span className="th-status failed">Failed</span>
  }
  if (status === 'broadcast') {
    return <span className="th-status pending">Broadcast</span>
  }
  return <span className="th-status pending">Pending</span>
}
