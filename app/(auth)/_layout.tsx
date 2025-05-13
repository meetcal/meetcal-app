import { Redirect, Stack } from 'expo-router'
import { useAuth } from '@clerk/clerk-expo'
import { useEffect, useState } from 'react'
import { getCachedAuthState } from '@/lib/authCache'
import NetInfo from '@react-native-community/netinfo'

export default function AuthRoutesLayout() {
  const { isSignedIn, isLoaded: isClerkLoaded } = useAuth()
  const [isCacheLoading, setIsCacheLoading] = useState(true)
  const [cachedIsSignedIn, setCachedIsSignedIn] = useState<boolean | null>(null)
  const [isOffline, setIsOffline] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOffline(state.isConnected === false)
    })
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    const checkAuthState = async () => {
      setIsCacheLoading(true)
      try {
        const cachedState = await getCachedAuthState()
        setCachedIsSignedIn(cachedState)
        setError(null)
      } catch (e) {
        console.error('Error checking cached auth state:', e)
        setError(e as Error)
        setCachedIsSignedIn(false)
      } finally {
        setIsCacheLoading(false)
      }
    }

    checkAuthState()
  }, [])

  // If offline, use cache as soon as it's loaded (don't wait for Clerk)
  if (isOffline && !isCacheLoading) {
    if (cachedIsSignedIn === true) {
      console.log('[AuthLayout] Offline: cache valid, redirecting to app.')
      return <Redirect href="/(tabs)/schedule" />
    } else {
      console.log('[AuthLayout] Offline: cache not valid, showing auth stack.')
      return <Stack />
    }
  }

  // If online, wait for both Clerk and cache to load
  if (!isClerkLoaded || isCacheLoading) {
    return null
  }

  if (error) {
    console.log('[AuthLayout] Error fetching cached auth state. Displaying auth stack.')
    return <Stack />
  }

  if (isClerkLoaded && isSignedIn) {
    console.log('[AuthLayout] Clerk loaded and user is signed in. Redirecting to app.')
    return <Redirect href="/(tabs)/schedule" />
  }

  if (isClerkLoaded && !isSignedIn) {
    if (cachedIsSignedIn === true) {
      console.log('[AuthLayout] Online: Clerk not signed in, but cache valid. Redirecting to app.')
      return <Redirect href="/(tabs)/schedule" />
    } else {
      console.log('[AuthLayout] Online: Clerk not signed in, cache not valid. Showing auth stack.')
      return <Stack />
    }
  }

  console.log('[AuthLayout] Fallback: No definitive auth state. Displaying auth stack.')
  return <Stack />
} 