import { Redirect } from 'expo-router'
import { useAuth } from '@clerk/expo'
import { ActivityIndicator, View } from 'react-native'
import { useEffect } from 'react'
import { DismissToRedirect } from '@/components/navigation/DismissToRedirect'
import * as WebBrowser from 'expo-web-browser'

WebBrowser.maybeCompleteAuthSession()

export default function OAuthNativeCallback() {
  const { isLoaded, isSignedIn } = useAuth()

  useEffect(() => {
    // Ensure the auth session is completed when returning from the browser.
    WebBrowser.maybeCompleteAuthSession()
  }, [])

  if (!isLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    )
  }

  // Signed in, pop back to the running tabs rather than stacking a second
  // tabs navigator; sign-in stays inside the auth stack.
  if (isSignedIn) return <DismissToRedirect href="/(tabs)/(index)" />
  return <Redirect href="/(auth)/sign-in" />
}
