// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { serve } from 'https://deno.fresh.run/std@0.168.0/http/server.ts'
// @deno-types="https://raw.githubusercontent.com/jsr-io/jsr-npm/main/packages/resend/index.d.ts"
import { Resend } from "npm:resend@2.1.0"

console.log("Hello from Functions!")

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { name, email, description } = await req.json()

    // Basic validation
    if (!name || !email || !description) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    const resend = new Resend(Deno.env.get('RESEND_API_KEY'))

    // Email HTML template
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
            <div class="content">${name} (${email})</div>
          </div>
          
          <div class="section">
            <div class="label">Feedback:</div>
            <div class="description">${description}</div>
          </div>
        </body>
      </html>
    `

    // Send email using Resend
    const { data, error } = await resend.emails.send({
      from: 'MeetCal Feedback <feedback@meetcal.app>',
      to: 'memohnsen@gmail.com',
      subject: `MeetCal Feedback from ${name}`,
      html: htmlContent,
      reply_to: email
    })

    if (error) {
      console.error('Resend error:', error)
      throw error
    }

    return new Response(
      JSON.stringify({ success: true, data }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to send feedback' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/meetcal-feedback' \
    --header 'Authorization: Bearer ' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
