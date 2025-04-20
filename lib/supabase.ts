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
    global: {
      fetch: async (url, options = {}) => {
        const token = await Clerk.session?.getToken({ template: 'supabase' });
        // Always use a plain object for headers
        const originalHeaders = (options.headers && !(options.headers instanceof Headers) ? options.headers : {}) as Record<string, string>;
        options.headers = {
          ...originalHeaders,
          apikey: supabaseAnonKey!,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };
        // Ensure Content-Type is set for requests with a body
        if (options.body && !('Content-Type' in (options.headers as Record<string, string>))) {
          (options.headers as Record<string, string>)['Content-Type'] = 'application/json';
        }
        console.log('[Supabase fetch override] Request headers:', options.headers);
        return fetch(url, options);
      },
    },
  }
) 