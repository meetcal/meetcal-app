# Marketing Notifications with Expo Push

## 1. Overview
- Marketing notifications are sent to users to promote features, updates, or offers.
- Use Expo Push Notifications service, leveraging existing device token management.
- All push tokens are stored in Supabase (`notification_preferences` table, `expo_push_token` field).

## 2. User Opt-in & Token Management
- Marketing notifications will be sent to **all users who have enabled notifications** and have a valid Expo push token.
- **The notification switch in the profile screen (`@profile.tsx`) does NOT affect marketing notifications.** That switch is for session reminders or transactional notifications only.
- Continue using the logic in `utils/notifications.ts` and `lib/notifications.ts` to register for push notifications and store tokens in Supabase.
- If you want to allow users to opt out of marketing notifications specifically, add a separate toggle for this purpose.

## 3. Backend Service for Sending Notifications
- **Why:** Marketing notifications must be sent from a secure backend, not from the client.
- **How:**
  1. Create a backend endpoint (e.g., serverless function or API route) that:
     - Queries Supabase for all users with `notification_enabled = true` and a non-null `expo_push_token`.
     - Sends a POST request to the Expo Push API for each token with the marketing message payload.
  2. Use Expo's `/v2/push/send` endpoint for sending notifications in batches.

## 4. Sending a Marketing Notification (Backend Steps)
1. Query Supabase for eligible users/tokens:
   - `SELECT expo_push_token FROM notification_preferences WHERE notification_enabled = true AND expo_push_token IS NOT NULL;`
2. Construct the marketing message payload (title, body, optional data).
3. Send the notification using Expo's push API:
   - POST to `https://exp.host/--/api/v2/push/send` with the payload.
4. Handle errors and clean up invalid tokens as needed.

## 5. References
- Token registration: `utils/notifications.ts`, `lib/notifications.ts`
- Supabase table: `notification_preferences`
- Expo Push API docs: https://docs.expo.dev/push-notifications/sending-notifications/
