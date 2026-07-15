import React, { useState, useEffect, useCallback } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { useSubscription, PLANS } from '../context/SubscriptionContext'
import CopyButton from './shared/CopyButton'

// ─── Backend URL ──────────────────────────────────────────────────
const BACKEND_URL = 'http://localhost:8000'

// ─── Default placeholder publishable key ───────────────────────────
// Replace with your actual Stripe Publishable Key from:
// https://dashboard.stripe.com/test/apikeys
const DEFAULT_STRIPE_PK = 'pk_test_51PbCxUCX9iJIBu4GHWEqx8UzNenVwRVzWThr7mEpxOTAPGfqOOKCsjxIQpJRpmCFQOXXOwXh5BlIda2fQ2klyPW500TgWq4Piv'

// ─── Stripe Options ───────────────────────────────────────────────
const appearance = {
  theme: 'night',
  labels: 'floating',
  variables: {
    colorPrimary: '#3b82f6',
    colorBackground: '#0f172a',
    colorText: '#e2e8f0',
    colorDanger: '#ef4444',
    fontFamily: '"Inter", system-ui, sans-serif',
    borderRadius: '8px',
  },
  rules: {
    '.Input': {
      backgroundColor: '#1e293b',
      border: '1px solid #334155',
      padding: '12px',
    },
    '.Input:focus': {
      borderColor: '#3b82f6',
      boxShadow: '0 0 0 1px #3b82f6',
    },
    '.Label': {
      color: '#94a3b8',
      fontSize: '13px',
      fontWeight: 500,
    },
  },
}

// ─── Inner checkout form (needs Stripe context) ───────────────────
function StripeCheckoutForm({ planId, plan, onComplete, onError, onCancel }) {
  const stripe = useStripe()
  const elements = useElements()
  const { user, purchasePlan } = useSubscription()
  const [status, setStatus] = useState('ready') // ready | processing | success | error
  const [errorMsg, setErrorMsg] = useState('')
  const [purchaseResult, setPurchaseResult] = useState(null)
  const [clientSecret, setClientSecret] = useState(null)

  // Create PaymentIntent on mount
  useEffect(() => {
    let cancelled = false
    const createPaymentIntent = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/stripe/create-payment-intent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan: planId,
            email: user?.email || 'guest@example.com',
          }),
          signal: AbortSignal.timeout(10000),
        })
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) {
            setClientSecret(data.client_secret)
          }
        } else {
          const err = await res.json().catch(() => ({ error: 'Failed to create payment' }))
          if (!cancelled) {
            setErrorMsg(err.error || 'Backend unavailable. Start the server to process payments.')
            setStatus('error')
          }
        }
      } catch (e) {
        if (!cancelled) {
          setErrorMsg('Backend unavailable. Start the server to process payments.')
          setStatus('error')
        }
      }
    }
    createPaymentIntent()
    return () => { cancelled = true }
  }, [planId, user])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!stripe || !elements || !clientSecret) return

    setStatus('processing')
    setErrorMsg('')

    // Confirm the payment with Stripe
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      clientSecret,
      confirmParams: {
        return_url: window.location.origin + '/payment-complete',
      },
      redirect: 'if_required',
    })

    if (confirmError) {
      setStatus('error')
      setErrorMsg(confirmError.message || 'Payment failed')
      onError?.(confirmError.message)
      return
    }

    if (paymentIntent?.status === 'succeeded' || paymentIntent?.status === 'processing') {
      // Payment succeeded — generate license key
      const result = await purchasePlan(planId, 'stripe')

      if (result.success) {
        setStatus('success')
        setPurchaseResult({
          licenseKey: result.licenseKey,
          plan: planId,
          planName: plan.name,
          planPrice: plan.price,
        })
        onComplete?.(result)

        // Notify backend about successful payment
        try {
          await fetch(`${BACKEND_URL}/api/stripe/confirm-payment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              payment_intent_id: paymentIntent.id,
              plan: planId,
              email: user?.email,
              license_key: result.licenseKey,
            }),
            signal: AbortSignal.timeout(5000),
          })
        } catch { /* fire-and-forget */ }
      } else {
        setStatus('error')
        setErrorMsg(result.error || 'Failed to generate license key')
        onError?.(result.error)
      }
    } else {
      setStatus('error')
      setErrorMsg(`Payment status: ${paymentIntent?.status || 'unknown'}`)
      onError?.('Payment did not complete')
    }
  }

  // Success state
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
    <form onSubmit={handleSubmit} className="stripe-form">
      {/* Error state */}
      {status === 'error' && (
        <div className="pp-error" style={{ marginBottom: 12 }}>
          <span>⚠ </span>
          {errorMsg || 'Payment failed. Please try again.'}
        </div>
      )}

      {/* Processing state */}
      {status === 'processing' && (
        <div className="pp-processing" style={{ marginBottom: 12 }}>
          <span className="spinner" />
          <span>Processing your payment...</span>
        </div>
      )}

      {/* Payment Element - shown when ready */}
      {clientSecret && stripe && status !== 'success' && (
        <div className="stripe-element-wrapper">
          <PaymentElement
            options={{
              layout: {
                type: 'tabs',
                defaultCollapsed: false,
              },
            }}
          />
        </div>
      )}

      {/* Loading state while creating PaymentIntent */}
      {!clientSecret && status === 'ready' && (
        <div className="pp-processing" style={{ marginBottom: 12 }}>
          <span className="spinner" />
          <span>Preparing payment form...</span>
        </div>
      )}

      {/* Submit button */}
      <button
        type="submit"
        className="btn btn-primary stripe-pay-btn"
        disabled={!stripe || !elements || !clientSecret || status === 'processing' || status === 'success'}
        style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}
      >
        {status === 'processing'
          ? 'Processing...'
          : `💳 Pay $${plan.price.toFixed(2)}`}
      </button>

      {/* Cancel button */}
      {status !== 'processing' && status !== 'success' && (
        <button
          type="button"
          className="btn btn-secondary stripe-cancel-btn"
          onClick={onCancel}
          style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
        >
          Cancel
        </button>
      )}

      <div className="pp-footer" style={{ marginTop: 8 }}>
        🔒 Secure payment via Stripe
      </div>
    </form>
  )
}

// ─── Main StripeCheckout component ─────────────────────────────────
export default function StripeCheckout({ planId, onComplete, onError }) {
  const plan = PLANS[planId]
  const [stripePromise, setStripePromise] = useState(null)
  const [pkError, setPkError] = useState('')

  // Load Stripe publishable key from backend or use default
  useEffect(() => {
    let cancelled = false
    const loadStripeKey = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/stripe/config`, {
          signal: AbortSignal.timeout(5000),
        })
        if (res.ok) {
          const data = await res.json()
          const pk = data.publishable_key
          if (pk && !cancelled) {
            setStripePromise(loadStripe(pk))
            return
          }
        }
      } catch { /* fall through to default */ }

      if (!cancelled) {
        // Use default test key
        setStripePromise(loadStripe(DEFAULT_STRIPE_PK))
      }
    }
    loadStripeKey()
    return () => { cancelled = true }
  }, [])

  if (!plan || plan.price <= 0) return null

  if (pkError) {
    return (
      <div className="pp-error">
        ⚠ {pkError}
      </div>
    )
  }

  // Show loading while Stripe loads
  if (!stripePromise) {
    return (
      <div className="pp-processing">
        <span className="spinner" />
        <span>Loading Stripe...</span>
      </div>
    )
  }

  return (
    <Elements stripe={stripePromise} options={{ appearance }}>
      <StripeCheckoutForm
        planId={planId}
        plan={plan}
        onComplete={onComplete}
        onError={onError}
        onCancel={() => onError?.('cancelled')}
      />
    </Elements>
  )
}
