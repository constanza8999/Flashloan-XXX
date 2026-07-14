import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { ethers } from 'ethers'

const Web3Context = createContext(null)

/**
 * WalletConnect Project ID.
 * Get your own free ID at https://cloud.walletconnect.com/
 */
const WALLETCONNECT_PROJECT_ID = 'YOUR_WALLETCONNECT_PROJECT_ID' // ⚠️ Replace with your own!

/**
 * Attempts to dynamically load the WalletConnect provider at runtime.
 * Uses new Function() to completely bypass Vite's static module resolution.
 * Returns null if the package isn't installed.
 */
async function getWalletConnectProvider() {
  try {
    // new Function() avoids Vite's static analysis of import()
    const dynImport = new Function('spec', 'return import(spec)')
    const mod = await dynImport('@walletconnect/ethereum-provider')
    return mod?.default || mod?.EthereumProvider || null
  } catch {
    return null
  }
}

export function Web3Provider({ children }) {
  const [walletAddress, setWalletAddress] = useState(null)
  const [walletProvider, setWalletProvider] = useState(null) // ethers.BrowserProvider or JsonRpcProvider
  const [signer, setSigner] = useState(null)
  const [chainId, setChainId] = useState(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [walletType, setWalletType] = useState(null) // 'metamask' | 'walletconnect' | null
  const [error, setError] = useState('')
  const [walletConnectProvider, setWalletConnectProvider] = useState(null) // raw provider instance

  // Stable refs for listeners to avoid stale closures
  // NOTE: Refs must be initialized AFTER all the values they reference exist
  const disconnectRef = useRef(null)
  const walletTypeRef = useRef(null)

  // Listen for account/chain changes on MetaMask
  useEffect(() => {
    if (!window.ethereum) return
    const handleAccountsChanged = (accounts) => {
      if (accounts.length === 0) {
        disconnectRef.current?.()
      } else {
        setWalletAddress(ethers.getAddress(accounts[0]))
      }
    }
    const handleChainChanged = () => {
      if (walletTypeRef.current === 'metamask') {
        try {
          const bp = new ethers.BrowserProvider(window.ethereum)
          setWalletProvider(bp)
        } catch {}
      }
    }
    window.ethereum.on('accountsChanged', handleAccountsChanged)
    window.ethereum.on('chainChanged', handleChainChanged)
    return () => {
      window.ethereum?.removeListener('accountsChanged', handleAccountsChanged)
      window.ethereum?.removeListener('chainChanged', handleChainChanged)
    }
  }, [])

  const disconnect = useCallback(() => {
    setWalletAddress(null)
    setWalletProvider(null)
    setSigner(null)
    setChainId(null)
    setWalletType(null)
    setWalletConnectProvider(null)
    setError('')
  }, [])

  // Update refs after all callbacks are defined
  disconnectRef.current = disconnect
  walletTypeRef.current = walletType

  const connectMetaMask = useCallback(async () => {
    setError('')
    setIsConnecting(true)
    try {
      if (!window.ethereum) {
        throw new Error('MetaMask is not installed. Please install MetaMask browser extension.')
      }
      const bp = new ethers.BrowserProvider(window.ethereum)
      const accounts = await bp.send('eth_requestAccounts', [])
      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts found. Please unlock MetaMask.')
      }
      const signer = await bp.getSigner()
      const network = await bp.getNetwork()
      const address = ethers.getAddress(accounts[0])

      setWalletAddress(address)
      setWalletProvider(bp)
      setSigner(signer)
      setChainId(Number(network.chainId))
      setWalletType('metamask')
    } catch (err) {
      setError(err.message || 'Failed to connect MetaMask')
    }
    setIsConnecting(false)
  }, [])

  const connectWalletConnect = useCallback(async () => {
    setError('')
    setIsConnecting(true)
    try {
      const WCProvider = await getWalletConnectProvider()
      if (!WCProvider) {
        throw new Error(
          'WalletConnect package not available. Install it:\n' +
          '  npm install @walletconnect/ethereum-provider\n' +
          'Then restart the app.'
        )
      }

      const provider = await WCProvider.init({
        projectId: WALLETCONNECT_PROJECT_ID,
        showQrModal: true,
        chains: [1, 56], // Ethereum + BSC
        optionalChains: [1, 56],
        metadata: {
          name: 'Flashloan Token Toolkit',
          description: 'Multi-chain token transfer toolkit',
          url: window.location.origin,
          icons: [`${window.location.origin}/favicon.ico`],
        },
      })

      await provider.enable()
      const wcProvider = new ethers.BrowserProvider(provider)
      const signer = await wcProvider.getSigner()
      const address = await signer.getAddress()
      const network = await wcProvider.getNetwork()

      setWalletAddress(address)
      setWalletProvider(wcProvider)
      setSigner(signer)
      setChainId(Number(network.chainId))
      setWalletType('walletconnect')
      setWalletConnectProvider(provider)
    } catch (err) {
      setError(err.message || 'Failed to connect WalletConnect')
    }
    setIsConnecting(false)
  }, [])

  const connectWallet = useCallback(async (type) => {
    if (type === 'metamask') {
      await connectMetaMask()
    } else if (type === 'walletconnect') {
      await connectWalletConnect()
    }
  }, [connectMetaMask, connectWalletConnect])

  const switchChain = useCallback(async (targetChainId) => {
    if (!walletProvider || !walletType) return
    try {
      if (walletType === 'metamask' && window.ethereum) {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x' + targetChainId.toString(16) }],
        })
        // Provider will be recreated via the chainChanged event
      } else if (walletType === 'walletconnect' && walletConnectProvider) {
        await walletConnectProvider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x' + targetChainId.toString(16) }],
        })
      }
    } catch (err) {
      // If chain not added, try to add it
      if (err.code === 4902) {
        const chainConfig = targetChainId === 56
          ? { chainId: '0x38', chainName: 'BNB Smart Chain', rpcUrls: ['https://bsc-dataseed.binance.org/'], nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 } }
          : targetChainId === 137
          ? { chainId: '0x89', chainName: 'Polygon Mainnet', rpcUrls: ['https://polygon-rpc.com'], nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 } }
          : targetChainId === 42161
          ? { chainId: '0xA4B1', chainName: 'Arbitrum One', rpcUrls: ['https://arb1.arbitrum.io/rpc'], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } }
          : { chainId: '0x1', chainName: 'Ethereum Mainnet', rpcUrls: ['https://eth.llamarpc.com'], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } }
        if (walletType === 'metamask' && window.ethereum) {
          await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [chainConfig] })
        }
      }
    }
  }, [walletProvider, walletType, walletConnectProvider])

  const getChainName = useCallback((id) => {
    if (!id) return 'Unknown'
    const names = { 1: 'Ethereum', 56: 'BSC', 137: 'Polygon', 42161: 'Arbitrum' }
    return names[id] || `Chain ${id}`
  }, [])

  const value = {
    walletAddress,
    walletProvider,
    signer,
    chainId,
    chainName: getChainName(chainId),
    isConnecting,
    walletType,
    error,
    connectWallet,
    connectMetaMask,
    connectWalletConnect,
    disconnect,
    switchChain,
    isConnected: !!walletAddress,
    getChainName,
  }

  return (
    <Web3Context.Provider value={value}>
      {children}
    </Web3Context.Provider>
  )
}

export function useWeb3() {
  const ctx = useContext(Web3Context)
  if (!ctx) throw new Error('useWeb3 must be used within a Web3Provider')
  return ctx
}

export default Web3Context
