import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'benchmarks/corpus/manifest.json'), 'utf8'));
const taskRoot = path.join(root, 'benchmarks/harbor/tasks');
const arms = ['raw', 'plan', 'lamina'];

assert.deepEqual(manifest.tasks.map((task) => task.id), ['dev-green-01', 'dev-green-02', 'dev-brown-01', 'dev-brown-02']);
assert.deepEqual(manifest.arms, arms);
assert.equal(fs.readdirSync(taskRoot).filter((name) => fs.statSync(path.join(taskRoot, name)).isDirectory()).length, 12);

for (const task of manifest.tasks) {
  for (const arm of arms) {
    const dir = path.join(taskRoot, `${task.id}-${arm}`);
    assert.ok(fs.existsSync(path.join(dir, 'task.toml')), `${dir} missing task.toml`);
    assert.ok(fs.existsSync(path.join(dir, 'environment/Dockerfile')), `${dir} missing Dockerfile`);
    assert.ok(fs.existsSync(path.join(dir, 'steps/fix/tests/grade.py')), `${dir} missing final grader`);
    const taskToml = fs.readFileSync(path.join(dir, 'task.toml'), 'utf8');
    assert.doesNotMatch(taskToml, /structured|control|treatment|codex|gpt-5\.6-sol/);
  }
}

const packageJson = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
assert.match(packageJson, /--agent claude-code --model sonnet/);

console.log('Harbor benchmark test passed: canonical corpus, arms, task files, and model lock are consistent.');
