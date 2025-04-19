import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

console.log('Send Marketing Push function booting up');

// Define the structure of the expected request body
interface RequestPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>; // Optional data payload
}

serve(async (req) => {
  // 1. Check if the request method is POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Parse the request body
  let payload: RequestPayload;
  try {
    payload = await req.json();
    if (!payload.title || !payload.body) {
      throw new Error('Missing title or body in request payload');
    }
  } catch (error) {
    console.error('Error parsing request body:', error);
    return new Response(JSON.stringify({ error: `Bad Request: ${error.message}` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 3. Initialize Supabase client
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN');

  if (!supabaseUrl || !supabaseServiceKey || !expoAccessToken) {
    console.error('Missing environment variables');
    return new Response(JSON.stringify({ error: 'Internal Server Error: Missing configuration' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // 4. Fetch eligible push tokens from Supabase
    const { data: tokensData, error: fetchError } = await supabaseAdmin
      .from('notification_preferences')
      .select('expo_push_token')
      .eq('notification_enabled', true)
      .not('expo_push_token', 'is', null); // Ensure token is not null

    if (fetchError) {
      throw new Error(`Supabase fetch error: ${fetchError.message}`);
    }

    if (!tokensData || tokensData.length === 0) {
      console.log('No eligible users found for push notification.');
      return new Response(JSON.stringify({ message: 'No eligible users found.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const pushTokens = tokensData.map(t => t.expo_push_token).filter(Boolean); // Filter out any potential nulls/empty strings
    console.log(`Found ${pushTokens.length} tokens to send notification to.`);

    // 5. Construct the Expo Push API payload
    // Expo recommends sending in batches, but we'll send all at once for simplicity here.
    // For large numbers of tokens, implement batching.
    const messages = pushTokens.map(token => ({
      to: token,
      sound: 'default',
      title: payload.title,
      body: payload.body,
      data: payload.data, // Include optional data if provided
    }));

    // 6. Send notification via Expo Push API
    const expoPushUrl = 'https://exp.host/--/api/v2/push/send';
    const expoResponse = await fetch(expoPushUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${expoAccessToken}`,
      },
      body: JSON.stringify(messages),
    });

    const expoResult = await expoResponse.json();

    // TODO: Add more robust handling of Expo response, check for errors, ticket IDs, invalid tokens etc.
    console.log('Expo Push API response:', expoResult);

    if (!expoResponse.ok) {
        throw new Error(`Expo API request failed with status ${expoResponse.status}: ${JSON.stringify(expoResult)}`);
    }

    return new Response(JSON.stringify({ success: true, message: `Notifications sent to ${pushTokens.length} users.`, expoResponse: expoResult }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error processing push notification request:', error);
    return new Response(JSON.stringify({ error: `Internal Server Error: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}); 