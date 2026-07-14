import { useState, useEffect } from 'react'
import { ethers } from 'ethers'

/**
 * Hook that establishes a connection to the first available RPC endpoint.
 * Returns an ethers.JsonRpcProvider instance or null if not connected.
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
          await p.getNetwork()
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
