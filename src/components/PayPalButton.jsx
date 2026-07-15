import React, { useState } from 'react'
import { PayPalButtons, PayPalScriptProvider } from '@paypal/react-paypal-js'
import { useSubscription, PLANS } from '../context/SubscriptionContext'
import CopyButton from './shared/CopyButton'

// ─── PayPal Client ID ──────────────────────────────────────────────
// Replace this with your actual PayPal Client ID from:
// https://developer.paypal.com/dashboard/applications
// Use a Sandbox Client ID for testing, Live Client ID for production.
const PAYPAL_CLIENT_ID = 'Ad4jGQvHX7wJBIG1cHbvl1Qq4-uoHChJ1rvo_fm2iK8FcP0YQTFyMqHRN0s5kQMn4lESyBZB0Dz13XPy'

// For development: use the sandbox environment
const PAYPAL_CURRENCY = 'USD'

// ─── Backend URL ──────────────────────────────────────────────────
const BACKEND_URL = 'http://localhost:8000'

// ─── Initialization options ───────────────────────────────────────
const initialOptions = {
  'client-id': PAYPAL_CLIENT_ID,
  currency: PAYPAL_CURRENCY,
  intent: 'capture',
  // Enable vault for future subscription billing
  'enable-funding': 'paylater,venmo',
  'disable-funding': 'card',
}

// ─── PayPalProvider wrapper ───────────────────────────────────────
export function PayPalProvider({ children }) {
  return (
    <PayPalScriptProvider options={initialOptions}>
      {children}
    </PayPalScriptProvider>
  )
}

// ─── PayPalSubscribeButton ─────────────────────────────────────────
export default function PayPalSubscribeButton({ planId, onComplete, onError }) {
  const { user, purchasePlan } = useSubscription()
  const [status, setStatus] = useState('idle') // idle | processing | success | error
  const [purchaseResult, setPurchaseResult] = useState(null)
  const plan = PLANS[planId]

  if (!plan || plan.price <= 0) return null

  const handleCreateOrder = async () => {
    setStatus('processing')

    // Try backend first
    try {
      const res = await fetch(`${BACKEND_URL}/api/paypal/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: planId,
          email: user?.email || 'guest@example.com',
          price: plan.price,
          currency: PAYPAL_CURRENCY,
        }),
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        const data = await res.json()
        return data.order_id || data.id
      }
    } catch { /* fall through to client-side order */ }

    // Client-side fallback: cannot create valid order without backend.
    // Throwing will cause PayPal to show a retry state to the user.
    throw new Error('Backend unavailable. Please start the server to process payments.')
  }

  const handleApprove = async (data) => {
    setStatus('processing')

    // Try backend capture first
    let captured = false
    if (data?.orderID) {
      try {
        const res = await fetch(`${BACKEND_URL}/api/paypal/capture-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_id: data.orderID,
            plan: planId,
            email: user?.email,
          }),
          signal: AbortSignal.timeout(10000),
        })
        if (res.ok) {
          captured = true
        }
      } catch { /* fall through */ }
    }

    // Local fallback: use the context purchasePlan
    const result = await purchasePlan(planId, 'paypal')

    if (result.success) {
      setStatus('success')
      setPurchaseResult({
        licenseKey: result.licenseKey,
        plan: planId,
        planName: plan.name,
        planPrice: plan.price,
      })
      onComplete?.(result)
    } else {
      setStatus('error')
      onError?.(result.error || 'Purchase failed')
    }
  }

  const handleError = (err) => {
    console.error('PayPal error:', err)
    setStatus('error')
    onError?.(err?.message || 'PayPal payment failed')
  }

  // Success state — show license key
  if (status === 'success' && purchaseResult) {
    return (
      <div className="pp-success">
        <div className="pp-success-icon">✅</div>
        <div className="pp-success-title">Payment Successful!</div>
        <div className="pp-success-plan">
          {purchaseResult.planName} — ${purchaseResult.planPrice.toFixed(2)}/mo
        </div>

        <div className="pp-license-box">
          <div className="pp-license-label">🔑 Your License Key</div>
          <div className="pp-license-key">{purchaseResult.licenseKey}</div>
          <div className="pp-license-actions">
            <CopyButton text={purchaseResult.licenseKey} />
          </div>
        </div>

        <div className="pp-success-note">
          A copy has been sent to your email. You can also activate it on the Subscription page.
        </div>
      </div>
    )
  }

  return (
    <div className="pp-button-wrapper">
      {/* Status indicator */}
      {status === 'processing' && (
        <div className="pp-processing">
          <span className="spinner" />
          <span>Processing your payment...</span>
        </div>
      )}

      {status === 'error' && (
        <div className="pp-error" style={{ marginBottom: 10 }}>
          ⚠ Payment failed. Please try again or use a different method.
        </div>
      )}

      <PayPalButtons
        style={{
          layout: 'vertical',
          color: 'gold',
          shape: 'rect',
          label: 'subscribe',
          height: 48,
        }}
        createOrder={handleCreateOrder}
        onApprove={handleApprove}
        onError={handleError}
        onCancel={() => setStatus('idle')}
        disabled={status === 'processing' || status === 'success'}
        forceReRender={[planId]}
      />

      <div className="pp-footer">
        🔒 Secure payment via PayPal
      </div>
    </div>
  )
}

// ─── CSS (injected as a style tag for simplicity) ─────────────────
// Main CSS is in styles.css under the .pp-* classes
