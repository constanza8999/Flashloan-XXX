import { useState, useEffect } from 'react'
import { ethers } from 'ethers'

/**
 * Hook that establishes a connection to the first available RPC endpoint.
 * Tests each RPC with getNetwork() AND getBlockNumber() to verify it's actually responsive
 * (not just connected but returning data). Falls through to the next RPC on failure.
 * Returns an ethers.JsonRpcProvider instance or null if all RPCs failed.
 */
export function useProvider(rpcs) {
  const [provider, setProvider] = useState(null)

  useEffect(() => {
    let cancelled = false

    const tryConnect = async () => {
      for (const rpc of rpcs) {
        if (cancelled) return
        try {
          const p = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true })
          // Test 1: Verify it's on the expected network
          await p.getNetwork()
          // Test 2: Verify it actually returns data (filters overloaded RPCs)
          await p.getBlockNumber()
          if (!cancelled) {
            setProvider(p)
            return
          }
        } catch {
          // Try next RPC
        }
      }
    }

    tryConnect()

    return () => {
      cancelled = true
    }
  }, rpcs) // eslint-disable-line react-hooks/exhaustive-deps

  return provider
}
