# MeetCal 📅

A React Native application built with Expo for managing athletic schedules and meet calendars.

[![MeetCal Demo](https://youtube.com/shorts/4xoIoYox3C0?feature=share)](https://youtube.com/shorts/4xoIoYox3C0?feature=share)

## Features

- 📅 Schedule management for athletes and meets
- 🏃‍♂️ Athlete data management
- 📊 Real-time data synchronization with Supabase
- 📱 Cross-platform support (iOS, Android)

## Tech Stack

- **Framework:** Expo / React Native
- **Database:** Supabase
- **Navigation:** Expo Router (file-based routing)
- **Language:** TypeScript

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Set up environment variables
   
   Create a `.env.local` file with your Supabase credentials:
   ```
   EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

3. Start the development server

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a:

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go)

## Project Structure

This project uses [file-based routing](https://docs.expo.dev/router/introduction) with the **app** directory containing all screens and navigation.

## Database

All schedule and athlete data is stored in and fetched from Supabase. The app follows these data access patterns:

- No hardcoded data for schedules or athletes
- All queries go through Supabase client
- Real-time updates supported

## Development

- Edit files in the **app** directory to modify screens and navigation
- Database schema and queries should be documented
- Maintain consistency with existing Supabase data patterns

## Learn more

- [Expo documentation](https://docs.expo.dev/)
- [Supabase documentation](https://supabase.com/docs)
- [React Native documentation](https://reactnative.dev/docs/getting-started)

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
