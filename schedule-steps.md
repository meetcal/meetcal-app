# Schedule Time Range Implementation Steps

## Overview
Currently all platforms in a session share the same start time. We need to modify the system to handle different start times per platform while maintaining backwards compatibility.

## Goals
- Keep existing behavior for sessions where all platforms start at same time
- For sessions with varied start times:
  - Display time range (e.g. "3:30-4:30 PM")
  - Show platform-specific time in details view
  - Create calendar events with correct platform-specific times

## Implementation Steps

1. Update Types
   - Add optional platformStartTime to Platform type
   - Update Schedule type to handle new field

2. Add Helper Functions
   - Create getSessionTimeRange() to determine if session has multiple times
   - Create getPlatformStartTime() to get specific platform time
   - Add time parsing/formatting utilities

3. Update Schedule Data
   - Add platformStartTime field only where needed
   - Keep existing format for uniform sessions
   - Document time format requirements

4. Modify Display Components
   - Update session list to show time ranges
   - Show platform-specific time in details view
   - Handle both single times and ranges

5. Update Calendar Integration
   - Modify calendar event creation to use platform-specific times
   - Update in saved sessions view
   - Update in start list view
   - Update in schedule details view

6. Testing
   - Test sessions with uniform times (verify no changes)
   - Test sessions with varied times:
     - Verify time range display
     - Check platform-specific times
     - Test calendar event creation
   - Test edge cases:
     - AM/PM handling
     - Midnight/noon cases
     - Missing platformStartTime
     - Invalid time formats

## Notes
- Maintain backwards compatibility
- Only show ranges when needed
- Keep time format consistent
- Consider timezone handling
