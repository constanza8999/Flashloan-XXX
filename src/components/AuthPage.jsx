import React, { useState } from 'react'
import { useSubscription, PLANS } from '../context/SubscriptionContext'

export default function AuthPage({ onNavigate }) {
  const { login, register, loading, isLoggedIn, user, userTier } = useSubscription()
  const [mode, setMode] = useState('login') // login | register | success
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccessMsg('')

    if (!email || !password) {
      setError('Please fill in all fields')
      return
    }

    if (mode === 'login') {
      const result = await login(email, password)
      if (result.success) {
        setSuccessMsg(`Welcome${result.user.name ? ', ' + result.user.name : ''}!`)
        setMode('success')
      } else {
        setError(result.error || 'Login failed. Check your credentials.')
      }
    } else {
      if (!name) { setError('Name is required'); return }
      const result = await register(email, password, name)
      if (result.success) {
        setSuccessMsg('Account created successfully! You can now subscribe to a plan.')
        setMode('success')
      } else {
        setError(result.error || 'Registration failed. Try again.')
      }
    }
  }

  const switchMode = (newMode) => {
    setMode(newMode)
    setError('')
    setSuccessMsg('')
  }

  // ─── Already logged in ──────────────────────────────────────
  if (isLoggedIn && user) {
    return (
      <div className="tool-page">
        <div className="tool-header">
          <span className="tool-icon">🔐</span>
          <div>
            <h2>My Account</h2>
            <p>You are signed in. Manage your account or choose a plan below.</p>
          </div>
        </div>

        {/* Account summary */}
        <div className="auth-welcome-card">
          <div className="awc-avatar">
            {user.name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <div className="awc-info">
            <h3>{user.name || 'User'}</h3>
            <p className="awc-email">{user.email}</p>
            <div className="awc-meta">
              <span className={`plan-tier-badge tier-${userTier}`}>
                {PLANS[userTier]?.icon} {PLANS[userTier]?.name || 'Free'}
              </span>
              {user.licenseKey && (
                <span className="awc-license-key" title={user.licenseKey}>
                  🔑 {user.licenseKey.slice(0, 14)}...
                </span>
              )}
            </div>
          </div>
          <div className="awc-actions">
            <button className="btn btn-primary" onClick={() => onNavigate?.('subscription')}>
              💳 View Plans
            </button>
          </div>
        </div>

        {/* Current plan features */}
        <div className="config-panel" style={{ marginTop: 20 }}>
          <h3>📋 Your {PLANS[userTier]?.name || 'Free'} Plan Features</h3>
          <ul className="plan-features" style={{ margin: 0, padding: 0 }}>
            {(PLANS[userTier]?.features || []).map((f, i) => (
              <li key={i} className="plan-feature">
                <span className="plan-feature-check">✓</span>
                {f}
              </li>
            ))}
          </ul>
          {userTier === 'free' && (
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <button className="btn btn-primary" onClick={() => onNavigate?.('subscription')}>
                ⭐ Upgrade to Pro — $29.99/mo
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ─── Success state after login/register ─────────────────────
  if (mode === 'success') {
    return (
      <div className="tool-page">
        <div className="auth-success-card">
          <div className="asc-icon">✅</div>
          <h2>{successMsg}</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
            {userTier === 'free'
              ? 'You are on the Free plan. Upgrade to Pro or Enterprise to unlock all features.'
              : 'Your account is active. You can access all features included in your plan.'}
          </p>
          <div className="asc-actions">
            {userTier === 'free' && (
              <button className="btn btn-primary" onClick={() => onNavigate?.('subscription')}>
                💳 Choose a Plan
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => onNavigate?.('dashboard')}>
              ◈ Go to Dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Login / Register form ───────────────────────────────────
  return (
    <div className="tool-page">
      <div className="auth-layout">
        {/* Left: Form */}
        <div className="auth-form-section">
          <div className="auth-form-card">
            <div className="auth-form-header">
              <div className="auth-tabs">
                <button
                  className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
                  onClick={() => switchMode('login')}
                >
                  🔐 Sign In
                </button>
                <button
                  className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
                  onClick={() => switchMode('register')}
                >
                  📝 Create Account
                </button>
              </div>
              <p className="auth-form-subtitle">
                {mode === 'login'
                  ? 'Sign in to activate your license key and access premium features.'
                  : 'Create a free account to purchase a subscription plan.'}
              </p>
            </div>

            {error && (
              <div className="error-box" style={{ marginBottom: 16 }}>
                <span className="error-icon">⚠</span> {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              {mode === 'register' && (
                <div className="form-group" style={{ marginBottom: 16 }}>
                  <label>Full Name</label>
                  <div className="input-icon-wrap">
                    <span className="input-icon">👤</span>
                    <input
                      type="text"
                      className="input input-with-icon"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="Your full name"
                    />
                  </div>
                </div>
              )}

              <div className="form-group" style={{ marginBottom: 16 }}>
                <label>Email Address</label>
                <div className="input-icon-wrap">
                  <span className="input-icon">📧</span>
                  <input
                    type="email"
                    className="input input-with-icon"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoFocus={mode === 'login'}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 24 }}>
                <label>Password</label>
                <div className="input-icon-wrap">
                  <span className="input-icon">🔑</span>
                  <input
                    type="password"
                    className="input input-with-icon"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary auth-submit-btn"
                disabled={loading}
              >
                {loading ? (
                  <><span className="spinner" /> Processing...</>
                ) : mode === 'login' ? (
                  '🔐 Sign In'
                ) : (
                  '📝 Create Free Account'
                )}
              </button>
            </form>

            <div className="auth-alt-action">
              {mode === 'login' ? (
                <span>
                  Don't have an account?{' '}
                  <button className="sm-link" onClick={() => switchMode('register')}>
                    Create one
                  </button>
                </span>
              ) : (
                <span>
                  Already have an account?{' '}
                  <button className="sm-link" onClick={() => switchMode('login')}>
                    Sign in
                  </button>
                </span>
              )}
            </div>

            <div className="auth-demo-note">
              <strong>💡 Demo mode:</strong> You can sign in with any email/password.
              Admin login: <strong>josejaimejulia7@gmail.com</strong>
            </div>
          </div>
        </div>

        {/* Right: Feature preview / plan upsell */}
        <div className="auth-preview-section">
          <div className="auth-preview-card">
            <h3>⭐ Pro Plan</h3>
            <div className="app-price-big">$29.99<span className="app-price-period">/mo</span></div>
            <ul className="auth-preview-features">
              {PLANS.pro.features.slice(0, 6).map((f, i) => (
                <li key={i}><span className="plan-feature-check">✓</span> {f}</li>
              ))}
              <li className="app-feature-more">+ 2 more features</li>
            </ul>
            <button
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
              onClick={() => onNavigate?.('subscription')}
            >
              See All Plans
            </button>
          </div>

          <div className="auth-preview-card auth-preview-enterprise">
            <h3>👑 Enterprise</h3>
            <div className="app-price-big">$99.99<span className="app-price-period">/mo</span></div>
            <ul className="auth-preview-features">
              {PLANS.enterprise.features.slice(0, 5).map((f, i) => (
                <li key={i}><span className="plan-feature-check">✓</span> {f}</li>
              ))}
              <li className="app-feature-more">+ 5 more features</li>
            </ul>
            <button
              className="btn btn-secondary"
              style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
              onClick={() => onNavigate?.('subscription')}
            >
              Learn More
            </button>
          </div>

          <div className="auth-preview-note">
            <p>🔒 Payments processed via <strong>PayPal</strong></p>
            <p>📧 License key delivered to your email</p>
            <p>🔄 Cancel anytime</p>
          </div>
        </div>
      </div>
    </div>
  )
}
