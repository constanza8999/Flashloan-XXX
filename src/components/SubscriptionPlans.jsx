import React, { useState } from 'react'
import { useSubscription, PLANS } from '../context/SubscriptionContext'
import CopyButton from './shared/CopyButton'
import LoadingButton from './shared/LoadingButton'
import PayPalSubscribeButton, { PayPalProvider } from './PayPalButton'
import StripeCheckout from './StripeCheckout'

export default function SubscriptionPlans({ onNavigate, onUpgrade }) {
  const { user, userTier, purchasePlan, activateLicense, loading, logout, isLoggedIn } = useSubscription()
  const [selectedPlan, setSelectedPlan] = useState(null)
  const [selectedPayment, setSelectedPayment] = useState('paypal')
  const [purchaseResult, setPurchaseResult] = useState(null)
  const [licenseKey, setLicenseKey] = useState('')
  const [activateResult, setActivateResult] = useState(null)
  const [activateError, setActivateError] = useState('')
  const [activating, setActivating] = useState(false)

  const currentPlan = PLANS[userTier]

  const handlePurchase = async (planId) => {
    setSelectedPlan(planId)
    setPurchaseResult(null)

    const result = await purchasePlan(planId, 'paypal')
    if (result.success) {
      setPurchaseResult({ plan: planId, licenseKey: result.licenseKey })
    } else {
      setPurchaseResult({ plan: planId, error: result.error || 'Purchase failed' })
    }
  }

  const handleActivate = async () => {
    if (!licenseKey.trim()) {
      setActivateError('Please enter a license key')
      return
    }
    setActivating(true)
    setActivateError('')
    setActivateResult(null)

    const result = await activateLicense(licenseKey.trim())
    if (result.success) {
      setActivateResult({ success: true, tier: result.tier })
      setLicenseKey('')
    } else {
      setActivateError(result.error || 'Activation failed')
    }
    setActivating(false)
  }

  // ─── Not logged in: show prompt ─────────────────────────────
  if (!isLoggedIn) {
    return (
      <div className="tool-page">
        <div className="tool-header">
          <span className="tool-icon">💳</span>
          <div>
            <h2>Subscription Plans</h2>
            <p>Choose the plan that fits your needs. Cancel anytime.</p>
          </div>
        </div>

        <div className="auth-signup-prompt">
          <div className="asp-icon">🔐</div>
          <h3>Sign in to Subscribe</h3>
          <p>
            Create a free account or sign in to purchase a subscription plan
            and unlock all premium features.
          </p>
          <div className="asp-actions">
            <button
              className="btn btn-primary"
              onClick={() => onNavigate?.('auth')}
            >
              🔐 Sign In / Create Account
            </button>
          </div>
          <div className="asp-features">
            <span>✓ Free plan available</span>
            <span>✓ PayPal payments</span>
            <span>✓ Cancel anytime</span>
          </div>
        </div>

        {/* Show plans preview so users can see what's available */}
        <div className="plans-grid">
          {Object.values(PLANS).map(plan => {
            const isCurrent = userTier === plan.id
            return (
              <div
                key={plan.id}
                className={`plan-card ${plan.popular ? 'plan-popular' : ''}`}
              >
                {plan.popular && <div className="plan-badge">Most Popular</div>}
                <div className="plan-header" style={{ '--plan-color': plan.color }}>
                  <span className="plan-icon">{plan.icon}</span>
                  <h3 className="plan-name">{plan.name}</h3>
                  <p className="plan-desc">{plan.description}</p>
                </div>
                <div className="plan-price">
                  {plan.price === 0 ? (
                    <span className="plan-price-free">Free</span>
                  ) : (
                    <>
                      <span className="plan-price-amount">${plan.price}</span>
                      <span className="plan-price-period">/{plan.period}</span>
                    </>
                  )}
                </div>
                <ul className="plan-features">
                  {plan.features.map((f, i) => (
                    <li key={i} className="plan-feature">
                      <span className="plan-feature-check">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="plan-action">
                  <button
                    className={`btn ${plan.popular ? 'btn-primary' : 'btn-secondary'}`}
                    disabled
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    {plan.price === 0 ? 'Free' : `💳 $${plan.price}/mo`}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">💳</span>
        <div>
          <h2>Subscription Plans</h2>
          <p>Choose the plan that fits your needs. Cancel anytime.</p>
        </div>
      </div>

      {/* Current plan status */}
      {user && (
        <div className="stats-bar" style={{ marginBottom: 28 }}>
          <div className="stat">
            <span className="stat-label">Account</span>
            <span className="stat-value" style={{ fontSize: 16, color: '#60a5fa' }}>
              {user.email}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Plan</span>
            <span className="stat-value" style={{ fontSize: 16 }}>
              {currentPlan?.icon} {currentPlan?.name || 'Free'}
            </span>
          </div>
          {user.licenseKey && (
            <div className="stat" style={{ flex: 1 }}>
              <span className="stat-label">License Key</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>
                  {user.licenseKey}
                </span>
                <CopyButton text={user.licenseKey} />
              </div>
            </div>
          )}
          <div className="stat" style={{ marginLeft: 'auto', justifyContent: 'center' }}>
            <button className="btn btn-secondary" onClick={logout} style={{ fontSize: 11, padding: '8px 16px' }}>
              🚪 Sign Out
            </button>
          </div>
        </div>
      )}

      {/* Plans grid */}
      <PayPalProvider>
        <div className="plans-grid">
          {Object.values(PLANS).map(plan => {
            const isCurrent = userTier === plan.id

            return (
              <div
                key={plan.id}
                className={`plan-card ${plan.popular ? 'plan-popular' : ''} ${isCurrent ? 'plan-current' : ''}`}
              >
                {plan.popular && <div className="plan-badge">Most Popular</div>}

                <div className="plan-header" style={{ '--plan-color': plan.color }}>
                  <span className="plan-icon">{plan.icon}</span>
                  <h3 className="plan-name">{plan.name}</h3>
                  <p className="plan-desc">{plan.description}</p>
                </div>

                <div className="plan-price">
                  {plan.price === 0 ? (
                    <span className="plan-price-free">Free</span>
                  ) : (
                    <>
                      <span className="plan-price-amount">${plan.price}</span>
                      <span className="plan-price-period">/{plan.period}</span>
                    </>
                  )}
                </div>

                <ul className="plan-features">
                  {plan.features.map((f, i) => (
                    <li key={i} className="plan-feature">
                      <span className="plan-feature-check">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                <div className="plan-action">
                  {isCurrent ? (
                    <button className="btn btn-secondary" disabled style={{ width: '100%', justifyContent: 'center' }}>
                      ✅ Current Plan
                    </button>
                  ) : plan.price === 0 ? (
                    <button className="btn btn-secondary" disabled style={{ width: '100%', justifyContent: 'center' }}>
                      Free
                    </button>                    ) : (
                      <div className="payment-methods">
                        {/* Payment method tabs */}
                        <div className="pm-tabs">
                          <button
                            className={`pm-tab ${selectedPayment === 'paypal' ? 'pm-tab-active' : ''}`}
                            onClick={() => setSelectedPayment('paypal')}
                          >
                            <span className="pm-tab-icon">
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <circle cx="8" cy="8" r="7" fill="#003087" />
                                <text x="5.5" y="11" fill="white" fontSize="7" fontWeight="bold">P</text>
                              </svg>
                            </span>
                            PayPal
                          </button>
                          <button
                            className={`pm-tab ${selectedPayment === 'stripe' ? 'pm-tab-active' : ''}`}
                            onClick={() => setSelectedPayment('stripe')}
                          >
                            <span className="pm-tab-icon">💳</span>
                            Card
                          </button>
                        </div>

                        {/* PayPal checkout */}
                        {selectedPayment === 'paypal' && (
                          <PayPalSubscribeButton
                            planId={plan.id}
                            onComplete={(result) => {
                              setSelectedPlan(plan.id)
                              setPurchaseResult({ plan: plan.id, licenseKey: result.licenseKey })
                            }}
                            onError={(err) => {
                              setPurchaseResult({ plan: plan.id, error: err })
                            }}
                          />
                        )}

                        {/* Stripe checkout */}
                        {selectedPayment === 'stripe' && (
                          <StripeCheckout
                            planId={plan.id}
                            onComplete={(result) => {
                              setSelectedPlan(plan.id)
                              setPurchaseResult({ plan: plan.id, licenseKey: result.licenseKey })
                            }}
                            onError={(err) => {
                              if (err !== 'cancelled') {
                                setPurchaseResult({ plan: plan.id, error: err })
                              }
                            }}
                          />
                        )}
                      </div>
                    )}
                </div>

                {purchaseResult?.plan === plan.id && (
                  <div className="plan-purchase-result">
                    {purchaseResult.error ? (
                      <div style={{ color: '#ef4444', fontSize: 12 }}>❌ {purchaseResult.error}</div>
                    ) : (
                      <div>
                        <div style={{ color: '#22c55e', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                          ✅ Purchase successful!
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          <div style={{ marginBottom: 4 }}>Your license key has been generated.</div>
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '8px 10px', background: 'rgba(0,0,0,0.2)',
                            borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 12,
                          }}>
                            <span>{purchaseResult.licenseKey}</span>
                            <CopyButton text={purchaseResult.licenseKey} />
                          </div>
                          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-dim)' }}>
                            A copy has also been sent to your email.
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </PayPalProvider>

      {/* Activate License */}
      <div className="config-panel">
        <h3>🔑 Activate License Key</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
          Already have a license key? Enter it below to unlock your plan.
        </p>
        <div className="form-grid">
          <div className="form-group">
            <label>License Key</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                className="input mono"
                value={licenseKey}
                onChange={e => setLicenseKey(e.target.value.toUpperCase())}
                placeholder="TK-XXXXX-XXXXX-XXXXX-XXXXX"
                style={{ flex: 1, fontSize: 13 }}
              />
              <LoadingButton
                loading={activating}
                loadingText="⏳"
                onClick={handleActivate}
              >
                🔑 Activate
              </LoadingButton>
            </div>
            <span className="form-hint">Enter the license key you received via email</span>
          </div>
        </div>

        {activateResult && (
          <div className="result-panel success" style={{ marginTop: 12 }}>
            <p>✅ Plan activated: <strong>{activateResult.tier}</strong></p>
          </div>
        )}

        {activateError && (
          <div className="error-box" style={{ marginTop: 12 }}>
            <span className="error-icon">⚠</span> {activateError}
          </div>
        )}
      </div>

      {/* Payment info */}
      <div className="config-panel" style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        <h3>💳 Payment Information</h3>
        <p>
          Payments are processed securely via <strong>PayPal</strong> or <strong>Stripe</strong>.
          PayPal payments go to <strong>josejaimejulia7@gmail.com</strong>.
          Stripe payments support all major credit/debit cards.
        </p>
        <p style={{ marginTop: 8 }}>
          After payment, your license key is generated instantly and displayed on screen.
          A copy is also sent to your email within 5 minutes.
        </p>
        <p style={{ marginTop: 8, color: 'var(--text-dim)' }}>
          Subscriptions auto-renew monthly. Cancel anytime from your account settings.
        </p>
      </div>
    </div>
  )
}
