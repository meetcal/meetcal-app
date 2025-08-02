// @ts-ignore

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// @ts-ignore
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

console.log('Send Marketing Push function booting up');

// Helper function to chunk array into smaller arrays
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

serve(async (req: Request) => {
  // 1. Authentication check - CRITICAL SECURITY
  const authHeader = req.headers.get('authorization')
  // @ts-ignore
  const expectedAuthKey = Deno.env.get('PUSH_NOTIFICATION_AUTH_KEY')
  
  if (!authHeader || !expectedAuthKey || authHeader !== `Bearer ${expectedAuthKey}`) {
    console.error('❌ Unauthorized push notification request')
    return new Response(JSON.stringify({
      error: 'Unauthorized'
    }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  // 2. Check if the request method is POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({
      error: 'Method Not Allowed'
    }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  // 2. Parse the request body
  let payload;
  try {
    payload = await req.json();
    if (!payload.title || !payload.body) {
      throw new Error('Missing title or body in request payload');
    }
  } catch (error: any) {
    console.error('Error parsing request body:', error);
    return new Response(JSON.stringify({
      error: `Bad Request: ${error.message}`
    }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  // 3. Initialize Supabase client
  // @ts-ignore
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  // @ts-ignore
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  // @ts-ignore
  const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN');

  if (!supabaseUrl || !supabaseServiceKey || !expoAccessToken) {
    console.error('Missing environment variables');
    return new Response(JSON.stringify({
      error: 'Internal Server Error: Missing configuration'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
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
      return new Response(JSON.stringify({
        message: 'No eligible users found.'
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }

    const pushTokens = tokensData
      .map((t: any) => t.expo_push_token)
      .filter(Boolean); // Filter out any potential nulls/empty strings

    console.log(`Found ${pushTokens.length} tokens to send notification to.`);

    // 5. Split tokens into chunks of 100 (Expo's limit)
    const BATCH_SIZE = 100;
    const tokenChunks = chunkArray(pushTokens, BATCH_SIZE);
    
    console.log(`Splitting ${pushTokens.length} tokens into ${tokenChunks.length} batches of max ${BATCH_SIZE} each.`);

    // 6. Send notifications in batches
    const expoPushUrl = 'https://exp.host/--/api/v2/push/send';
    const results = [];
    let totalSent = 0;
    let totalErrors = 0;

    for (let i = 0; i < tokenChunks.length; i++) {
      const chunk = tokenChunks[i];
      console.log(`Sending batch ${i + 1}/${tokenChunks.length} with ${chunk.length} tokens`);

      // @ts-ignore
      const messages = chunk.map((token: string) => ({
        to: token,
        sound: 'default',
        title: payload.title,
        body: payload.body,
        data: payload.data
      }));

      try {
        const expoResponse = await fetch(expoPushUrl, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Accept-encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${expoAccessToken}`
          },
          body: JSON.stringify(messages)
        });

        const expoResult = await expoResponse.json();
        
        if (!expoResponse.ok) {
          console.error(`Batch ${i + 1} failed:`, expoResult);
          results.push({
            batch: i + 1,
            success: false,
            error: `Expo API request failed with status ${expoResponse.status}: ${JSON.stringify(expoResult)}`
          });
          totalErrors += chunk.length;
        } else {
          console.log(`Batch ${i + 1} successful:`, expoResult);
          results.push({
            batch: i + 1,
            success: true,
            tokensSent: chunk.length,
            expoResponse: expoResult
          });
          totalSent += chunk.length;
        }
      } catch (error: any) {
        console.error(`Batch ${i + 1} failed with exception:`, error);
        results.push({
          batch: i + 1,
          success: false,
          error: error.message
        });
        totalErrors += chunk.length;
      }

      // Add a small delay between batches to avoid rate limiting
      if (i < tokenChunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // 7. Return comprehensive results
    const success = totalErrors === 0;
    return new Response(JSON.stringify({
      success,
      summary: {
        totalTokens: pushTokens.length,
        totalSent,
        totalErrors,
        batchesProcessed: tokenChunks.length
      },
      results,
      message: success 
        ? `Successfully sent notifications to ${totalSent} users in ${tokenChunks.length} batches.`
        : `Sent notifications to ${totalSent} users with ${totalErrors} errors in ${tokenChunks.length} batches.`
    }), {
      status: success ? 200 : 207, // 207 Multi-Status for partial success
      headers: {
        'Content-Type': 'application/json'
      }
    });

  } catch (error: any) {
    console.error('Error processing push notification request:', error);
    return new Response(JSON.stringify({
      error: `Internal Server Error: ${error.message}`
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
});
