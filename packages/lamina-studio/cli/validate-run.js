import { validateRunYaml } from '../lib/run.mjs';

export async function runValidateRun(args) {
  const target = args[0];
  if (!target) throw new Error('Usage: lamina-studio validate run <run.yaml>');

  const { ok, errors } = validateRunYaml(target);

  if (!ok) {
    console.error('Run validation FAILED:\n');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(`OK — ${target} validated`);
}
