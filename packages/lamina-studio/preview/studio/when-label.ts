export function whenLabel(when: string): string {
  const labels: Record<string, string> = {
    collection_empty: 'collection is empty',
    not_found: 'resource not found',
    validation_failed: 'validation fails',
    state_disallows: 'action not allowed in current state',
    concurrent_edit: 'concurrent edit conflict',
    session_expired: 'session expired',
    forbidden: 'access denied',
    dependency_unavailable: 'dependency unavailable',
    limit_reached: 'limit reached',
    timeout: 'request times out',
  };
  return labels[when] ?? when.replace(/_/g, ' ');
}
