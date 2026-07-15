import React, { useState, useCallback } from 'react'

/**
 * A compact copy-to-clipboard button.
 * @param {{ text: string, label?: string, className?: string, style?: object }} props
 */
export default function CopyButton({ text, label = '📋', className = '', style = {} }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard not available */ }
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className={`copy-btn ${className}`}
      title={copied ? 'Copied!' : 'Copy to clipboard'}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: 13,
        padding: '2px 6px',
        borderRadius: 4,
        color: copied ? 'var(--accent-green)' : 'var(--text-dim)',
        transition: 'color 0.2s',
        lineHeight: 1,
        ...style,
      }}
      onMouseEnter={e => { if (!copied) e.target.style.color = 'var(--text-primary)' }}
      onMouseLeave={e => { if (!copied) e.target.style.color = 'var(--text-dim)' }}
    >
      {copied ? '✓ Copied!' : (label || '📋')}
    </button>
  )
}
