import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

const fixtureSchema = JSON.parse(fs.readFileSync(new URL('./schema/fixture.schema.json', import.meta.url), 'utf8'));
const resultSchema = JSON.parse(fs.readFileSync(new URL('./schema/result.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });

export const validateFixtureSchema = ajv.compile(fixtureSchema);
export const validateResultSchema = ajv.compile(resultSchema);

export function schemaErrors(validator) {
  return (validator.errors || []).map((error) => `${error.instancePath || '$'} ${error.message}`);
}
