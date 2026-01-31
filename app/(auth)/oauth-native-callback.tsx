import { Redirect } from 'expo-router'
import { useAuth } from '@clerk/clerk-expo'
import { ActivityIndicator, View } from 'react-native'
import { useEffect } from 'react'
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

  return <Redirect href={isSignedIn ? '/(tabs)' : '/(auth)/sign-in'} />
}
