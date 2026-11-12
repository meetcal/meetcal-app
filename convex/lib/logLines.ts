export const ITEMS_PER_LOG_LINE = 50;

export function logInLines(heading: string, items: readonly string[], log: (line: string) => void = console.log): void {
  for (let i = 0; i < items.length; i += ITEMS_PER_LOG_LINE) log(`${heading}\n${items.slice(i, i + ITEMS_PER_LOG_LINE).join('\n')}`);
}
