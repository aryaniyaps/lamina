/**
 * Simple duplicate detection utility.
 * Generates a fuzzy hash based on amount, posted date (day), and merchant name.
 * Used to flag potential duplicate transactions when importing from Plaid.
 */
export function generateDuplicateHash(amountCents: number, postedAt: Date, merchantName?: string): string {
  const dateKey = postedAt.toISOString().split('T')[0]; // YYYY-MM-DD
  const merchantKey = merchantName ? merchantName.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  const raw = `${amountCents}|${dateKey}|${merchantKey}`;
  // Simple deterministic hash – DJB2
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 33) ^ raw.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}
