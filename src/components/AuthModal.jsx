import React, { useState } from 'react'
import { useSubscription } from '../context/SubscriptionContext'

export default function AuthModal({ onClose }) {
  const { login, register, loading } = useSubscription()
  const [mode, setMode] = useState('login') // login | register
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!email || !password) {
      setError('Please fill in all fields')
      return
    }

    if (mode === 'login') {
      const result = await login(email, password)
      if (result.success) {
        setSuccess(`Welcome${result.user.name ? ', ' + result.user.name : ''}!`)
        setTimeout(onClose, 800)
      } else {
        setError(result.error || 'Login failed')
      }
    } else {
      if (!name) { setError('Name is required'); return }
      const result = await register(email, password, name)
      if (result.success) {
        setSuccess('Account created! Welcome aboard.')
        setTimeout(onClose, 800)
      } else {
        setError(result.error || 'Registration failed')
      }
    }
  }

  return (
    <div className="wallet-modal-overlay" onClick={onClose}>
      <div className="wallet-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <div className="wallet-modal-header">
          <h3>{mode === 'login' ? '🔐 Sign In' : '📝 Create Account'}</h3>
          <button className="wallet-modal-close" onClick={onClose}>✕</button>
        </div>
        <p className="wallet-modal-desc">
          {mode === 'login'
            ? 'Sign in to activate your license key and unlock premium features.'
            : 'Create an account to purchase a subscription plan.'}
        </p>

        {error && (
          <div className="error-box" style={{ marginBottom: 16 }}>
            <span className="error-icon">⚠</span> {error}
          </div>
        )}

        {success && (
          <div className="result-panel success" style={{ marginBottom: 16, padding: 14 }}>
            <p style={{ color: 'var(--accent-green)', margin: 0 }}>✅ {success}</p>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label>Name</label>
              <input
                type="text"
                className="input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name"
              />
            </div>
          )}

          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>Email</label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus
            />
          </div>

          <div className="form-group" style={{ marginBottom: 20 }}>
            <label>Password</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          <div className="form-actions" style={{ marginBottom: 0 }}>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ flex: 1, justifyContent: 'center' }}
              disabled={loading}
            >
              {loading ? <><span className="spinner" /> Processing...</> : mode === 'login' ? '🔐 Sign In' : '📝 Create Account'}
            </button>
          </div>
        </form>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
          {mode === 'login' ? (
            <>Don't have an account?{' '}
              <button className="sm-link" onClick={() => { setMode('register'); setError(''); setSuccess('') }}>
                Create one
              </button>
            </>
          ) : (
            <>Already have an account?{' '}
              <button className="sm-link" onClick={() => { setMode('login'); setError(''); setSuccess('') }}>
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
