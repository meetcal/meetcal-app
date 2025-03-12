# Meet-Specific Data Implementation Plan

## 1. Data Structure Reorganization ✅
1. Create a new `meets` directory in the data folder ✅
2. Create subdirectories for each meet: ✅
   - `meets/usaw-masters-nationals` ✅
   - `meets/usamw-masters-nationals` ✅
3. Create a shared types directory for common interfaces ✅
4. Define meet configuration type for meet-specific settings ✅

## 2. Data File Migration
1. Move and split schedule.ts: ✅
   - Create meet-specific schedule files ✅
   - Update schedule types for meet variations ✅
   - Create schedule utility functions ✅

2. Split athletes.ts:
   - Separate athlete lists by meet ✅
   - Maintain common athlete interfaces ✅
   - Update athlete utility functions ✅

3. Split qualifying.ts:
   - Create meet-specific qualifying standards
   - Share common qualifying interfaces
   - Update qualifying utility functions

4. Split americanRecords.ts:
   - Create meet-specific record files
   - Maintain shared record interfaces
   - Update record utility functions

## 3. Access Pattern Updates
1. Create a meet configuration manager: ✅
   - Meet selection state management ✅
   - Meet-specific settings access ✅
   - Time zone handling ✅

2. Update data access utilities:
   - Create meet-specific data loaders ✅
   - Update helper functions for meet context ✅
   - Implement data validation ✅

## 4. Component Updates
1. Update schedule-details.tsx: ✅
   - Add meet-specific athlete handling ✅
   - Update session display logic ✅
   - Modify platform handling ✅
   - Update calendar integration with time zones ✅

2. Update saved.tsx: ✅
   - Add meet information to session storage ✅
   - Update session display for meet context ✅
   - Modify filtering for meet-specific data ✅
   - Update session refresh logic ✅
   - Update calendar integration with time zones ✅

3. Update start-list.tsx: ✅
   - Add meet-specific athlete handling ✅
   - Update filtering logic ✅
   - Modify display formatting ✅
   - Fix meet switching functionality ✅
   - Update calendar integration with time zones ✅

4. Update qualifying-totals.tsx:
   - Implement meet-specific standards
   - Update calculation logic
   - Modify display formatting

## 7. Future-Proofing
1. Create meet addition template
2. Document meet integration process
3. Create meet validation tools
4. Establish meet update process

## 8. Calendar Integration
1. Update calendar utilities: ✅
   - Meet-specific time zone handling ✅
   - Time conversion functions ✅
   - Calendar event formatting ✅

2. Update calendar event creation: ✅
   - Add meet-specific time zones ✅
   - Handle platform-specific times ✅
   - Update event details format ✅
   - Update saved.tsx calendar integration ✅

3. Test calendar integration:
   - Verify time zone handling
   - Test event creation
   - Validate event details
