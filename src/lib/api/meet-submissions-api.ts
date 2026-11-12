import { requireToken, userCall } from '@/lib/api/meetcal-api';
import { assertHasFields } from '@/lib/api/api-validators';

export async function generateMeetSubmissionUploadUrl(token: string): Promise<string> {
  const authToken = requireToken(token, 'generateMeetSubmissionUploadUrl');
  const row = assertHasFields(
    await userCall('/meet-submissions/upload-url', 'meetSubmissions:generateUploadUrl', 'mutation', authToken),
    '/meet-submissions/upload-url',
    ['uploadUrl'],
  );
  if (typeof row.uploadUrl !== 'string' || !/^https:\/\//.test(row.uploadUrl)) {
    throw new Error('/meet-submissions/upload-url.uploadUrl expected an https URL');
  }
  return row.uploadUrl;
}

export interface MeetSubmissionBody {
  meetName: string;
  startDate: string;
  endDate: string | null;
  contactEmail: string | null;
  files: { storageId: string; name: string }[];
}

export async function submitMeet(token: string, body: MeetSubmissionBody): Promise<void> {
  const authToken = requireToken(token, 'submitMeet');
  const row = assertHasFields(
    await userCall('/meet-submissions', 'meetSubmissions:submit', 'mutation', authToken, { ...body }),
    '/meet-submissions',
    ['submitted'],
  );
  if (row.submitted !== true) throw new Error('/meet-submissions.submitted expected true');
}
