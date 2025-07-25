# Authentication & Security 🔐

This document covers the authentication system, user management, role-based access control, and security considerations in the MeetCal application.

## Authentication Overview

MeetCal uses **Clerk** as the primary authentication provider, integrated with **Supabase** for user profile data storage and **RevenueCat** for subscription management.

```
Authentication Flow:
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│    Clerk    │◄──►│   MeetCal   │◄──►│  Supabase   │
│(Auth Server)│    │   Client    │    │ (Database)  │
└─────────────┘    └─────────────┘    └─────────────┘
       │                   │                   │
       ▼                   ▼                   ▼
  JWT Tokens        User Sessions      User Profiles
  Social Auth       Context State      Role Management
  Session Mgmt      Local Storage      RLS Policies
```

## Authentication Configuration

### Clerk Setup

**Location**: `app/_layout.tsx`

```typescript
import { ClerkProvider, useAuth } from '@clerk/clerk-expo'
import { tokenCache } from '@clerk/clerk-expo/token-cache'

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!

if (!publishableKey) {
  throw new Error('Missing Clerk publishable key')
}

export default function RootLayout() {
  return (
    <ClerkProvider 
      tokenCache={tokenCache} 
      publishableKey={publishableKey}
    >
      <NavigationContainer>
        <AuthenticatedApp />
      </NavigationContainer>
    </ClerkProvider>
  )
}
```

### Authentication Cache

**Location**: `lib/authCache.ts`

```typescript
import * as SecureStore from 'expo-secure-store'
import { TokenCache } from '@clerk/clerk-expo/token-cache'

// Secure token storage implementation
const createTokenCache = (): TokenCache => {
  return {
    async getToken(key: string): Promise<string | undefined> {
      try {
        const item = await SecureStore.getItemAsync(key)
        return item ?? undefined
      } catch (error) {
        console.error('SecureStore get item error:', error)
        return undefined
      }
    },

    async saveToken(key: string, token: string): Promise<void> {
      try {
        await SecureStore.setItemAsync(key, token)
      } catch (error) {
        console.error('SecureStore save item error:', error)
      }
    },

    async clearToken(key: string): Promise<void> {
      try {
        await SecureStore.deleteItemAsync(key)
      } catch (error) {
        console.error('SecureStore delete item error:', error)
      }
    },
  }
}

export const tokenCache = createTokenCache()
```

## Authentication Flows

### Sign In Flow

**Location**: `app/(auth)/sign-in.tsx`

```typescript
import { useSignIn } from '@clerk/clerk-expo'
import { useState } from 'react'
import { useRouter } from 'expo-router'

export default function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSignIn = async () => {
    if (!isLoaded) return
    
    setLoading(true)
    
    try {
      const signInAttempt = await signIn.create({
        identifier: email,
        password,
      })

      if (signInAttempt.status === 'complete') {
        await setActive({ session: signInAttempt.createdSessionId })
        
        // Sync with Supabase after successful authentication
        await syncUserWithSupabase()
        
        router.replace('/(tabs)/schedule')
      } else {
        // Handle additional verification steps
        handleIncompleteSignIn(signInAttempt)
      }
    } catch (error: any) {
      handleAuthError(error)
    } finally {
      setLoading(false)
    }
  }

  const handleSocialSignIn = async (strategy: 'oauth_google' | 'oauth_apple') => {
    if (!isLoaded) return

    try {
      const redirectUrl = Linking.createURL('/(tabs)/schedule')
      
      const signInAttempt = await signIn.create({
        strategy,
        redirectUrl,
      })

      if (signInAttempt.status === 'complete') {
        await setActive({ session: signInAttempt.createdSessionId })
        router.replace('/(tabs)/schedule')
      }
    } catch (error: any) {
      handleAuthError(error)
    }
  }

  // ... rest of component
}
```

### Sign Up Flow

**Location**: `app/(auth)/sign-up.tsx`

```typescript
import { useSignUp } from '@clerk/clerk-expo'

export default function SignUpScreen() {
  const { signUp, setActive, isLoaded } = useSignUp()
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    role: 'Athlete' as UserRole,
  })

  const handleSignUp = async () => {
    if (!isLoaded) return

    try {
      const signUpAttempt = await signUp.create({
        emailAddress: formData.email,
        password: formData.password,
        firstName: formData.firstName,
        lastName: formData.lastName,
      })

      if (signUpAttempt.status === 'complete') {
        await setActive({ session: signUpAttempt.createdSessionId })
        
        // Create user profile in Supabase
        await createUserProfile({
          id: signUpAttempt.createdUserId!,
          email: formData.email,
          name: `${formData.firstName} ${formData.lastName}`,
          role: formData.role,
        })
        
        router.replace('/(tabs)/schedule')
      } else if (signUpAttempt.status === 'missing_requirements') {
        // Handle email verification
        await handleEmailVerification(signUpAttempt)
      }
    } catch (error: any) {
      handleAuthError(error)
    }
  }

  // ... rest of component
}
```

### Email Verification

```typescript
const handleEmailVerification = async (signUpAttempt: SignUpResource) => {
  try {
    // Send verification email
    await signUpAttempt.prepareEmailAddressVerification({
      strategy: 'email_code',
    })

    // Navigate to verification screen
    router.push({
      pathname: '/(auth)/verify-email',
      params: { email: formData.email },
    })
  } catch (error) {
    console.error('Email verification error:', error)
  }
}

const completeEmailVerification = async (code: string) => {
  if (!signUp) return

  try {
    const verificationAttempt = await signUp.attemptEmailAddressVerification({
      code,
    })

    if (verificationAttempt.status === 'complete') {
      await setActive({ session: verificationAttempt.createdSessionId })
      router.replace('/(tabs)/schedule')
    }
  } catch (error) {
    handleVerificationError(error)
  }
}
```

## User Profile Management

### Supabase Integration

**Location**: `lib/profile.ts`

```typescript
import { supabase } from './supabase'
import { User } from '@clerk/clerk-expo'

export type UserRole = 'Athlete' | 'Coach' | 'Spectator' | 'Official' | 'Vendor' | 'Media'

export interface UserProfile {
  id: string
  email: string
  name: string
  role: UserRole
  avatar_url?: string
  team?: string
  bio?: string
  created_at: string
}

export async function createUserProfile(user: {
  id: string
  email: string
  name: string
  role: UserRole
}): Promise<void> {
  const { error } = await supabase
    .from('user_profiles')
    .insert({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    })

  if (error) {
    console.error('Error creating user profile:', error)
    throw new Error('Failed to create user profile')
  }
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      // User profile doesn't exist
      return null
    }
    throw error
  }

  return data
}

export async function updateUserProfile(
  userId: string,
  updates: Partial<Omit<UserProfile, 'id' | 'created_at'>>
): Promise<void> {
  const { error } = await supabase
    .from('user_profiles')
    .update(updates)
    .eq('id', userId)

  if (error) {
    throw error
  }
}

export async function syncUserWithSupabase(): Promise<void> {
  try {
    const user = await getCurrentUser()
    if (!user) return

    // Check if profile exists
    const existingProfile = await getUserProfile(user.id)
    
    if (!existingProfile) {
      // Create new profile
      await createUserProfile({
        id: user.id,
        email: user.emailAddresses[0]?.emailAddress || '',
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        role: 'Athlete', // Default role
      })
    } else {
      // Update existing profile with latest Clerk data
      await updateUserProfile(user.id, {
        email: user.emailAddresses[0]?.emailAddress || existingProfile.email,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || existingProfile.name,
      })
    }
  } catch (error) {
    console.error('User sync error:', error)
  }
}
```

## Role-Based Access Control

### User Roles

```typescript
export const USER_ROLES = {
  ATHLETE: 'Athlete',
  COACH: 'Coach',
  SPECTATOR: 'Spectator',
  OFFICIAL: 'Official',
  VENDOR: 'Vendor',
  MEDIA: 'Media',
} as const

export const ROLE_PERMISSIONS = {
  [USER_ROLES.ATHLETE]: {
    canViewResults: true,
    canCreateWarmups: true,
    canSaveSessions: true,
    canViewSchedule: true,
    canEditProfile: true,
    canSubmitFeedback: true,
  },
  [USER_ROLES.COACH]: {
    canViewResults: true,
    canCreateWarmups: true,
    canSaveSessions: true,
    canViewSchedule: true,
    canEditProfile: true,
    canSubmitFeedback: true,
    canViewTeamData: true,
    canManageAthletes: true,
  },
  [USER_ROLES.SPECTATOR]: {
    canViewResults: true,
    canViewSchedule: true,
    canEditProfile: true,
    canSubmitFeedback: true,
  },
  [USER_ROLES.OFFICIAL]: {
    canViewResults: true,
    canViewSchedule: true,
    canEditProfile: true,
    canSubmitFeedback: true,
    canAccessOfficialTools: true,
  },
  [USER_ROLES.VENDOR]: {
    canViewSchedule: true,
    canEditProfile: true,
    canSubmitFeedback: true,
    canManageSponsorship: true,
  },
  [USER_ROLES.MEDIA]: {
    canViewResults: true,
    canViewSchedule: true,
    canEditProfile: true,
    canSubmitFeedback: true,
    canAccessMediaTools: true,
  },
}
```

### Permission Checking

```typescript
export function hasPermission(
  userRole: UserRole,
  permission: keyof typeof ROLE_PERMISSIONS[UserRole]
): boolean {
  return ROLE_PERMISSIONS[userRole]?.[permission] ?? false
}

export function usePermissions() {
  const { user } = useUser()
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)

  useEffect(() => {
    if (user) {
      getUserProfile(user.id).then(setUserProfile)
    }
  }, [user])

  const checkPermission = useCallback((permission: string) => {
    if (!userProfile) return false
    return hasPermission(userProfile.role, permission as any)
  }, [userProfile])

  return {
    userRole: userProfile?.role,
    checkPermission,
    isAthlete: userProfile?.role === USER_ROLES.ATHLETE,
    isCoach: userProfile?.role === USER_ROLES.COACH,
    isOfficial: userProfile?.role === USER_ROLES.OFFICIAL,
  }
}
```

### Protected Components

```typescript
interface ProtectedComponentProps {
  permission: string
  fallback?: React.ReactNode
  children: React.ReactNode
}

export function ProtectedComponent({ 
  permission, 
  fallback = null, 
  children 
}: ProtectedComponentProps) {
  const { checkPermission } = usePermissions()

  if (!checkPermission(permission)) {
    return fallback
  }

  return <>{children}</>
}

// Usage example:
<ProtectedComponent 
  permission="canCreateWarmups"
  fallback={<Text>You don't have permission to create warmups</Text>}
>
  <CreateWarmupButton />
</ProtectedComponent>
```

## Database Security

### Row Level Security (RLS)

```sql
-- Enable RLS on user_profiles table
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can only view and edit their own profile
CREATE POLICY "Users can view own profile" ON user_profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE USING (auth.uid() = id);

-- Coaches can view profiles of their athletes
CREATE POLICY "Coaches can view athlete profiles" ON user_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM coach_athlete_relationships
      WHERE coach_id = auth.uid() AND athlete_id = user_profiles.id
    )
  );

-- Meet access policies
CREATE POLICY "Users can view all meets" ON meets
  FOR SELECT USING (true);

CREATE POLICY "Officials can manage meets" ON meets
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'Official'
    )
  );
```

### API Security

```typescript
// Middleware for API route protection
export function withAuth(handler: (req: Request, user: User) => Promise<Response>) {
  return async (req: Request) => {
    try {
      const token = req.headers.get('Authorization')?.replace('Bearer ', '')
      
      if (!token) {
        return new Response('Unauthorized', { status: 401 })
      }

      // Verify token with Clerk
      const user = await verifyToken(token)
      
      if (!user) {
        return new Response('Invalid token', { status: 401 })
      }

      return handler(req, user)
    } catch (error) {
      return new Response('Authentication error', { status: 500 })
    }
  }
}

// Usage in API routes
export const GET = withAuth(async (req, user) => {
  // Protected API logic here
  const userProfile = await getUserProfile(user.id)
  return Response.json({ user: userProfile })
})
```

## Session Management

### Session Persistence

```typescript
// Custom hook for session management
export function useSession() {
  const { isSignedIn, user, isLoaded } = useUser()
  const [sessionValid, setSessionValid] = useState(false)

  useEffect(() => {
    if (isLoaded) {
      setSessionValid(isSignedIn)
      
      if (isSignedIn && user) {
        // Update last activity timestamp
        updateUserActivity(user.id)
      }
    }
  }, [isSignedIn, isLoaded, user])

  const refreshSession = useCallback(async () => {
    try {
      // Force refresh the session
      await getSession()?.reload()
    } catch (error) {
      console.error('Session refresh error:', error)
      setSessionValid(false)
    }
  }, [])

  return {
    isAuthenticated: sessionValid,
    user,
    isLoading: !isLoaded,
    refreshSession,
  }
}
```

### Automatic Session Refresh

```typescript
// Session monitoring
export function SessionMonitor() {
  const { getToken } = useAuth()

  useEffect(() => {
    const checkSession = async () => {
      try {
        const token = await getToken()
        if (!token) {
          // Session expired, redirect to login
          router.replace('/(auth)/sign-in')
        }
      } catch (error) {
        console.error('Session check error:', error)
      }
    }

    // Check session every 5 minutes
    const interval = setInterval(checkSession, 5 * 60 * 1000)
    
    return () => clearInterval(interval)
  }, [getToken])

  return null
}
```

## Security Best Practices

### Data Encryption

```typescript
// Sensitive data encryption for local storage
import CryptoJS from 'crypto-js'

const ENCRYPTION_KEY = 'your-encryption-key' // In production, use secure key management

export function encryptData(data: string): string {
  return CryptoJS.AES.encrypt(data, ENCRYPTION_KEY).toString()
}

export function decryptData(encryptedData: string): string {
  const bytes = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY)
  return bytes.toString(CryptoJS.enc.Utf8)
}

// Use for sensitive cached data
export async function setSecureItem(key: string, value: string): Promise<void> {
  const encrypted = encryptData(value)
  await AsyncStorage.setItem(key, encrypted)
}

export async function getSecureItem(key: string): Promise<string | null> {
  const encrypted = await AsyncStorage.getItem(key)
  if (!encrypted) return null
  
  try {
    return decryptData(encrypted)
  } catch (error) {
    console.error('Decryption error:', error)
    return null
  }
}
```

### Input Sanitization

```typescript
// Sanitize user inputs to prevent XSS
export function sanitizeUserInput(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove HTML tags
    .replace(/javascript:/gi, '') // Remove javascript: links
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim()
}

// Validate and sanitize form data
export function validateAndSanitizeForm(formData: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {}
  
  for (const [key, value] of Object.entries(formData)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeUserInput(value)
    } else {
      sanitized[key] = value
    }
  }
  
  return sanitized
}
```

### Error Handling

```typescript
// Secure error handling that doesn't leak sensitive information
export function handleAuthError(error: any): string {
  console.error('Authentication error:', error)
  
  // Map specific errors to user-friendly messages
  const errorMessages: Record<string, string> = {
    'invalid_credentials': 'Invalid email or password',
    'too_many_requests': 'Too many login attempts. Please try again later.',
    'email_not_verified': 'Please verify your email address',
    'account_locked': 'Your account has been temporarily locked',
  }
  
  const userMessage = errorMessages[error.code] || 'An error occurred during authentication'
  
  // Don't expose internal error details to users
  return userMessage
}
```

---

*This authentication system provides secure, scalable user management with role-based access control and comprehensive security measures.*