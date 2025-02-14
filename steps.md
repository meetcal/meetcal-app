# User Data Implementation Plan

## 1. Initial Supabase Project Setup
- Install Supabase client libraries:
  ```bash
  npm install @supabase/supabase-js
  ```
- Create environment configuration file `.env`:
  - Add Supabase URL
  - Add Supabase anon/public key
- Create Supabase client configuration file:
  - Create new file `lib/supabase.ts`
  - Initialize Supabase client
  - Export client for use across app

## 2. Supabase Database Setup
- Create new table `user_profiles` with columns:
  - `id` (uuid, primary key)
  - `user_id` (uuid, foreign key to auth.users)
  - `name` (text)
  - `email` (text)
  - `role` (text)
  - `created_at` (timestamp with timezone)
  - `updated_at` (timestamp with timezone)
- Set up Row Level Security (RLS) policies:
  - Users can only read/write their own profile
  - Admin can read all profiles

## 3. Create User Profile Screen
- Create new screen `app/(screens)/user-profile.tsx`
- Design form with:
  - Name input field
  - Email input field
  - Role selector (Athlete/Coach/Spectator)
  - Submit button
- Add form validation
- Implement navigation flow between onboarding and subscription screens

## 4. Update Navigation Flow
- Modify onboarding flow to include new profile screen
- Update navigation order:
  1. Initial onboarding screens
  2. User profile collection
  3. Subscription screen

## 5. Supabase Integration
- Set up Supabase client configuration
- Create helper functions for:
  - Creating new user profile
  - Updating existing profile
  - Fetching profile data
- Implement error handling

## 6. Profile Tab Implementation
- Add profile section to info tab
- Create profile view component
- Add edit profile functionality
- Display user information:
  - Name
  - Email
  - Role
  - Subscription status

## 7. Testing & Validation
- Test user profile creation
- Verify data storage in Supabase
- Test profile updates
- Validate navigation flow
- Check error handling
- Test edge cases

## 8. Security & Privacy
- Implement data validation
- Add input sanitization
- Set up appropriate Supabase RLS (Row Level Security) policies
- Ensure email verification process

## 9. Polish & Deployment
- Add loading states
- Implement error messages
- Add success notifications
- Test on both iOS and Android
- Prepare for app store submission

## Notes
- Supabase Project ID: ztziuiiharxtvzitwzfv
- Project URL: https://ztziuiiharxtvzitwzfv.supabase.co
- Remember to use environment variables for API keys in production
- Implement proper error handling for network issues
- Consider offline support for profile data
