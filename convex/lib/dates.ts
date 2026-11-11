
export const DAY_MS = 24 * 60 * 60 * 1000;

export const pad2 = (n: number) => String(n).padStart(2, '0');

export const MONTH_NUMBERS: Readonly<Record<string, number>> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export const plusYears = (date: string, years: number) => `${String(Number(date.slice(0, 4)) + years).padStart(4, '0')}${date.slice(4)}`;
