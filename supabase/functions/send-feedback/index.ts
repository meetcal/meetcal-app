import "jsr:@supabase/functions-js/edge-runtime.d.ts"
// @ts-ignore
import { Resend } from "npm:resend"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Input validation
const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

const sanitizeInput = (input: string): string => {
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .slice(0, 1000) // Limit length
}

const validateInput = (data: any) => {
  const { name, email, role, description } = data

  if (!name || typeof name !== 'string' || name.trim().length < 1 || name.length > 100) {
    throw new Error('Invalid name: must be 1-100 characters')
  }
  
  if (!email || typeof email !== 'string' || !isValidEmail(email)) {
    throw new Error('Invalid email address')
  }
  
  if (!role || typeof role !== 'string' || role.trim().length < 1) {
    throw new Error('Role is required')
  }
  
  if (!description || typeof description !== 'string' || description.trim().length < 1) {
    throw new Error('Description is required')
  }
}
// @ts-ignore
Deno.serve(async (req) => {
  console.log('🚀 Edge Function started - send-feedback')
  console.log('📨 Request method:', req.method)
  console.log('🌐 Request URL:', req.url)
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    console.log('✅ Handling CORS preflight request')
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Only allow POST requests
    if (req.method !== 'POST') {
      console.log('❌ Invalid method:', req.method)
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { 
          status: 405, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Get the Resend API key from environment variables
    // @ts-ignore
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    
    if (!resendApiKey) {
      console.error('❌ RESEND_API_KEY environment variable is not set')
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    console.log('✅ RESEND_API_KEY found')

    // Initialize Resend
    const resend = new Resend(resendApiKey)
    console.log('📧 Resend client initialized')

    // Parse and validate input
    console.log('📝 Parsing request body...')
    const requestData = await req.json()
    console.log('📋 Request data received:', { 
      hasName: !!requestData.name, 
      hasEmail: !!requestData.email, 
      hasRole: !!requestData.role, 
      hasDescription: !!requestData.description 
    })
    
    console.log('🔍 Validating input...')
    validateInput(requestData)
    console.log('✅ Input validation passed')

    const { name, email, role, description } = requestData

    // Sanitize inputs
    const sanitizedName = sanitizeInput(name)
    const sanitizedRole = sanitizeInput(role)
    const sanitizedDescription = sanitizeInput(description)

    // Create HTML email content
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              font-size: 24px;
              font-weight: bold;
              margin-bottom: 20px;
              color: #007AFF;
            }
            .section {
              margin-bottom: 20px;
            }
            .label {
              font-weight: bold;
              color: #666;
            }
            .content {
              margin-top: 8px;
            }
            .description {
              background-color: #f5f5f5;
              padding: 15px;
              border-radius: 8px;
              margin-top: 8px;
            }
          </style>
        </head>
        <body>
          <div class="header">MeetCal Feedback</div>
          
          <div class="section">
            <div class="label">From:</div>
            <div class="content">${sanitizedName} (${email})</div>
          </div>
          
          <div class="section">
            <div class="label">Role:</div>
            <div class="content">${sanitizedRole}</div>
          </div>
          
          <div class="section">
            <div class="label">Feedback:</div>
            <div class="description">${sanitizedDescription}</div>
          </div>
        </body>
      </html>
    `

    // Send email
    console.log('📤 Sending email via Resend...')
    const { data, error } = await resend.emails.send({
      from: 'MeetCal Feedback <feedback@meetcal.app>',
      to: 'maddisen@meetcal.app',
      subject: `MeetCal Feedback from ${sanitizedName}`,
      html: htmlContent,
      replyTo: email
    })

    if (error) {
      console.error('❌ Resend error:', error)
      return new Response(
        JSON.stringify({ error: 'Failed to send email' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    console.log('✅ Email sent successfully via Resend', { id: data?.id })

    // Success response
    console.log('🎉 Returning success response')
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Feedback sent successfully',
        id: data?.id 
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('💥 Function error:', error)
    console.error('🔍 Error details:', {
      // @ts-ignore
      name: error?.name,
      // @ts-ignore
      message: error?.message,
      // @ts-ignore
      stack: error?.stack
    })
    
    // Return validation errors with 400 status
    if (error instanceof Error && error.message.startsWith('Invalid')) {
      console.log('⚠️ Returning validation error (400)')
      return new Response(
        JSON.stringify({ error: error.message }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Return generic error for other issues
    console.log('💀 Returning internal server error (500)')
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})