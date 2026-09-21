import { Redirect, Stack } from 'expo-router'
import { useAuth } from '@clerk/expo'
import { useEffect, useState } from 'react'
import { getCachedAuthState } from '@/lib/authCache'
import { isNetworkAvailable, subscribeToNetworkChanges } from '@/lib/networkUtils'
import { resolveAuthRouteTarget } from '@/utils/authGuard'

export default function AuthRoutesLayout() {
  const { isSignedIn, isLoaded: isClerkLoaded } = useAuth()
  const [isCacheLoading, setIsCacheLoading] = useState(true)
  const [cachedIsSignedIn, setCachedIsSignedIn] = useState<boolean | null>(null)
  const [isOffline, setIsOffline] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // Check network availability on mount and listen for changes
  useEffect(() => {
    let cancelled = false

    async function recheckNetwork() {
      try {
        const hasNetwork = await isNetworkAvailable()
        if (!cancelled) setIsOffline(!hasNetwork)
      } catch (err) {
        console.error('[AuthLayout] Error checking network availability:', err)
        // Assume offline on error
        if (!cancelled) setIsOffline(true)
      }
    }

    // Check immediately on mount
    recheckNetwork()

    // Go through the shared subscription rather than NetInfo directly. A raw
    // `state.isConnected === false` disagrees with `isNetworkAvailable()` (and
    // with every other subscriber in the app), which keys off
    // `isInternetReachable`: on a captive-portal or dead-router Wi-Fi the
    // listener would report "online", cancel the offline branch below, and
    // then wait forever on a Clerk handshake that cannot complete — a
    // permanently blank auth screen.
    const unsubscribe = subscribeToNetworkChanges(isConnected => {
      if (!cancelled) setIsOffline(!isConnected)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const checkAuthState = async () => {
      setIsCacheLoading(true)
      try {
        const cachedState = await getCachedAuthState()
        if (cancelled) return
        setCachedIsSignedIn(cachedState?.isSignedIn ?? null)
        setError(null)
      } catch (e) {
        console.error('Error checking cached auth state:', e)
        if (cancelled) return
        setError(e as Error)
        setCachedIsSignedIn(false)
      } finally {
        if (!cancelled) setIsCacheLoading(false)
      }
    }

    checkAuthState()

    return () => {
      cancelled = true
    }
  }, [])

  const target = resolveAuthRouteTarget({
    isOffline,
    isCacheLoading,
    hasError: error !== null,
    isClerkLoaded,
    isSignedIn,
    cachedIsSignedIn,
  })

  if (target === 'loading') return null
  if (target === 'app') return <Redirect href="/(tabs)/(index)" />
  return <Stack screenOptions={{ headerShown: false }} />
}
