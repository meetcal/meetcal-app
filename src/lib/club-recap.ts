export function formatMakeRate(rate: number | undefined): string {
  return `${Math.round(rate ?? 0)}%`;
}
