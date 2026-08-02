import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

const resultSchema = JSON.parse(fs.readFileSync(
  new URL('./schema/result.schema.json', import.meta.url),
  'utf8',
));
const fixtureSchema = JSON.parse(fs.readFileSync(
  new URL('./schema/fixture.schema.json', import.meta.url),
  'utf8',
));
const currentObservationSchema = JSON.parse(fs.readFileSync(
  new URL('./schema/current-observation.schema.json', import.meta.url),
  'utf8',
));

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(resultSchema);

export const validateResultSchema = ajv.getSchema(resultSchema.$id);
export const validateFixtureSchema = ajv.compile(fixtureSchema);
export const validateCurrentObservationSchema = ajv.compile(currentObservationSchema);

export function schemaErrors(validator) {
  return (validator.errors || []).map((error) => {
    const location = error.instancePath || '$';
    return `${location} ${error.message}`;
  });
}
