import { gradeBehavior } from './behavior-grade.mjs';
import { checkPilotLaminaTreatment } from './pilot-treatment.mjs';

export async function gradePilotBehavior({
  root = '/app',
  treatmentRoot = root,
  golden,
  arm = 'direct',
  phase = 'verify_fix',
  taskId = 'dev-care-circle',
}) {
  const behaviorArm = arm === 'lamina' ? 'direct' : arm;
  const result = await gradeBehavior({ root, golden, arm: behaviorArm, phase, taskId });

  if (arm !== 'lamina') {
    return {
      ...result,
      development_only: true,
      confirmatory: false,
      child_actual_model_unverified: true,
    };
  }

  const treatment = checkPilotLaminaTreatment(treatmentRoot, phase);
  const invalidTreatment = !treatment.valid;

  return {
    ...result,
    arm,
    treatment: {
      ...treatment,
      envelope: 'development_only',
      child_actual_model_unverified: true,
    },
    invalid_treatment: invalidTreatment,
    reward: invalidTreatment ? 0 : result.reward,
    development_only: true,
    confirmatory: false,
    child_actual_model_unverified: true,
  };
}
