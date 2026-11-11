export const PLACEHOLDER_MEMBER_ID_PREFIX = 'noid:';

export function placeholderMemberId(name: string): string {
  const normalized = name.split(/\s+/).filter(Boolean).join(' ').toLowerCase();
  return `${PLACEHOLDER_MEMBER_ID_PREFIX}${normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

export const isPlaceholderMemberId = (id: string) => id.startsWith(PLACEHOLDER_MEMBER_ID_PREFIX);

export const hasNoMemberId = (id: string) => id === '' || isPlaceholderMemberId(id);

export const ONE_OFF_MEMBER_ID = /^[1-9]\d{8}$/;
