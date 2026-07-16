import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'

const ToastContext = createContext(null)

let toastIdCounter = 0

/**
 * Global toast notification provider.
 * Place at the app root to enable toast() anywhere via useToast() hook.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timersRef = useRef({})

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id])
      delete timersRef.current[id]
    }
  }, [])

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = ++toastIdCounter
    const toast = { id, message, type, duration, timestamp: Date.now() }
    setToasts(prev => [toast, ...prev.slice(0, 4)])

    if (duration > 0) {
      timersRef.current[id] = setTimeout(() => removeToast(id), duration)
    }

    return id
  }, [removeToast])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach(clearTimeout)
    }
  }, [])

  const toast = useCallback((message, type = 'info', duration) => {
    return addToast(message, type, duration)
  }, [addToast])

  const dismiss = useCallback((id) => {
    removeToast(id)
  }, [removeToast])

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      {/* Toast Container */}
      <div className="toast-container">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`toast toast-${t.type}`}
            onClick={() => removeToast(t.id)}
            role="alert"
          >
            <span className="toast-icon">
              {t.type === 'success' ? '✅' :
               t.type === 'error' ? '❌' :
               t.type === 'warn' || t.type === 'warning' ? '⚠️' :
               t.type === 'profit' ? '💰' :
               t.type === 'connect' ? '🔗' :
               t.type === 'trade' ? '💹' :
               t.type === 'system' ? '⚙️' : 'ℹ️'}
            </span>
            <span className="toast-message">{t.message}</span>
            <button className="toast-close" onClick={(e) => { e.stopPropagation(); removeToast(t.id) }}>✕</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}

export default ToastContext
