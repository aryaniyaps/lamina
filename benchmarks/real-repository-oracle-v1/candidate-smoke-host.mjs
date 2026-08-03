import { brownfieldSignals } from '../../packages/cli/lib/observation-runtime/node.mjs';
import {
  PERSONA_PROBE_EVIDENCE_SCHEMA,
  serializeCandidateRawArtifact,
} from './candidate-contract.mjs';
import { digest } from './contract.mjs';
import { CANDIDATE_SMOKE_ADAPTER, reconstructSmokeCandidateArtifact } from './candidate-smoke.mjs';

export function hostProductionPersonaProbeEvidence(publicBatch) {
  const observed = brownfieldSignals(
    publicBatch.persona_probe.path,
    Buffer.from(publicBatch.persona_probe.content, 'utf8'),
  );
  const observations = observed.categories.map((category) => ({
    category, path: publicBatch.persona_probe.path,
  }));
  return {
    schema: PERSONA_PROBE_EVIDENCE_SCHEMA,
    input_sha256: publicBatch.persona_probe.content_sha256,
    observations,
    observations_sha256: digest(observations),
  };
}

export function hostSmokeCandidateProductionBytes(publicBatch, collection, scenario) {
  const artifact = structuredClone(reconstructSmokeCandidateArtifact(publicBatch, collection, scenario));
  artifact.persona_probe = hostProductionPersonaProbeEvidence(publicBatch);
  return serializeCandidateRawArtifact(artifact, publicBatch, CANDIDATE_SMOKE_ADAPTER);
}
