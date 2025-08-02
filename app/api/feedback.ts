import { createClient } from '@supabase/supabase-js'

// Create a separate client for Edge Functions (without Clerk auth)
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

const supabaseForFunctions = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false, // Don't persist sessions for function calls
  }
})

export async function sendFeedback({ name, email, role, description }: { 
  name: string
  email: string
  role: string
  description: string 
}) {
  console.log('🔍 Attempting to send feedback via Edge Function...')
  console.log('📧 Data:', { name, email, role: role.substring(0, 10) + '...', description: description.substring(0, 20) + '...' })
  
  try {
    // Call the secure Edge Function instead of using Resend directly
    const { data, error } = await supabaseForFunctions.functions.invoke('send-feedback', {
      body: {
        name,
        email,
        role,
        description
      }
    })

    console.log('📨 Edge Function response:', { data, error })

    if (error) {
      console.error('❌ Edge Function error details:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      })
      throw new Error(error.message || 'Failed to send feedback')
    }

    if (!data?.success) {
      console.error('❌ Edge Function returned error:', data)
      throw new Error(data?.error || 'Failed to send feedback')
    }

    console.log('✅ Feedback sent successfully!')
    return data
  } catch (err) {
    console.error('💥 Unexpected error in sendFeedback:', err)
    throw err
  }
} 