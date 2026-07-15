import React from 'react'

/**
 * Button with loading spinner and disabled state.
 * @param {{ loading: boolean, loadingText?: string, children: React.ReactNode, onClick: fn, variant?: string, disabled?: boolean, style?: object, className?: string }} props
 */
export default function LoadingButton({
  loading, loadingText = '⏳ Processing...',
  children, onClick, variant = 'btn-primary',
  disabled = false, style = {}, className = '',
}) {
  return (
    <button
      className={`btn ${variant} ${className}`}
      onClick={onClick}
      disabled={disabled || loading}
      style={style}
    >
      {loading ? loadingText : children}
    </button>
  )
}
