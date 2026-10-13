/**
 * How the reference tables (records, WSO and adaptive records, A/B
 * standards) show a weight. The tables answer `0` for "no record set / no
 * standard" (every U15 B standard, unset masters records) and `null` for a
 * lift the source left out; showing either as "0kg" reads as a mark anyone
 * beats with an empty bar. The CLI's `qualify` command treats `<= 0` the same
 * way, and so does Siri's `kgString` (plugins/ios-app-intents/Intents.swift).
 */
export const MISSING_REFERENCE_VALUE = "—";

/** A record, lift or standard in kilograms, or "—" when there is none. */
export function formatReferenceKg(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return MISSING_REFERENCE_VALUE;
  return `${value}kg`;
}
