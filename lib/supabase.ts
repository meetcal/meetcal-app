import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import { Database } from './database.types'
import { Clerk } from '@clerk/clerk-expo'

// Create a single supabase client for interacting with your database
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

console.log('Initializing Supabase client with URL:', supabaseUrl);
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables!');
  console.error('EXPO_PUBLIC_SUPABASE_URL:', supabaseUrl);
  console.error('EXPO_PUBLIC_SUPABASE_ANON_KEY:', supabaseAnonKey ? '[PRESENT]' : '[MISSING]');
}

export const supabase = createClient<Database>(
  supabaseUrl!,
  supabaseAnonKey!,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    // Use the new Clerk third-party auth integration
    // This replaces the custom fetch function approach
    accessToken: async () => {
      try {
        // Get the session token directly from Clerk session
        // No need for template parameter with the new integration
        const token = await Clerk.session?.getToken();
        return token ?? null;
      } catch (error) {
        console.error('Error getting Clerk session token:', error);
        return null;
      }
    },
  }
) 