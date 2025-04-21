import { Redirect, Stack } from 'expo-router'
import { useAuth } from '@clerk/clerk-expo'
import { useEffect, useState } from 'react'
import { getCachedAuthState } from '@/lib/authCache'

export default function AuthRoutesLayout() {
  const { isSignedIn } = useAuth()
  const [isLoading, setIsLoading] = useState(true)
  const [cachedIsSignedIn, setCachedIsSignedIn] = useState<boolean | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const checkAuthState = async () => {
      try {
        const cachedState = await getCachedAuthState()
        setCachedIsSignedIn(cachedState)
        setError(null)
      } catch (error) {
        console.error('Error checking cached auth state:', error)
        setError(error as Error)
        // On error, assume not signed in to be safe
        setCachedIsSignedIn(false)
      } finally {
        setIsLoading(false)
      }
    }

    checkAuthState()
  }, [])

  // If we're still loading, show nothing (splash screen will handle this)
  if (isLoading) {
    return null
  }

  // If we have an error, be safe and show auth screens
  if (error) {
    return <Stack />
  }

  // If we have a cached auth state and we're offline, use that
  if (cachedIsSignedIn !== null && !isSignedIn) {
    return cachedIsSignedIn ? <Redirect href="/(tabs)/schedule" /> : <Stack />
  }

  // Otherwise use the real auth state
  if (isSignedIn) {
    return <Redirect href="/(tabs)/schedule" />
  }

  return <Stack />
} 