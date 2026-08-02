import { digest } from './contract.mjs';

export function heldOutProjection(fixture) {
  return {
    workflow: fixture.workflowQueries.filter((row) => row.split === 'held_out')
      .map((row) => [row.graph, row.kind, row.query, row.expected]),
    source: fixture.sourceQueries.filter((row) => row.split === 'held_out')
      .map((row) => [row.graph, row.workflow, row.kind, row.query, row.expected_file]),
  };
}

export function heldOutIdentity(fixture) {
  const projected = heldOutProjection(fixture);
  const workflowBytes = JSON.stringify(projected.workflow);
  const sourceBytes = JSON.stringify(projected.source);
  return {
    workflow_rows: projected.workflow.length,
    workflow_rows_bytes: Buffer.byteLength(workflowBytes),
    workflow_rows_sha256: digest(workflowBytes),
    source_rows: projected.source.length,
    source_rows_bytes: Buffer.byteLength(sourceBytes),
    source_rows_sha256: digest(sourceBytes),
  };
}
