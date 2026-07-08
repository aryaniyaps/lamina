export const SCENARIO_CATEGORIES = [
  'empty',
  'precondition',
  'partial',
  'conflict',
  'failure',
  'permission',
  'external',
  'boundary',
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  empty: 'Empty',
  precondition: 'Precondition',
  partial: 'Partial',
  conflict: 'Conflict',
  failure: 'Failure',
  permission: 'Permission',
  external: 'External',
  boundary: 'Boundary',
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}
