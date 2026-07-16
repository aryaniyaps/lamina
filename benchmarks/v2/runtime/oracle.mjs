#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

export const TOPICS = new Set(['users', 'scope', 'ownership', 'authority', 'identity', 'lifecycle', 'failure', 'recovery', 'notifications', 'money', 'privacy', 'retention', 'compliance', 'platform', 'success']);

export function answerQuestions(questionsDocument, founderIntent) {
  const questions = questionsDocument?.questions;
  if (!Array.isArray(questions)) throw new Error('questions.json requires questions[]');
  if (questions.length > 3) throw new Error('Founder oracle accepts at most three questions');
  const answers = [];
  for (const question of questions) {
    if (!question.id || !TOPICS.has(question.topic) || !question.question) throw new Error(`Invalid question ${question.id || '(missing id)'}`);
    const facts = (founderIntent.facts || []).filter((fact) => fact.topic === question.topic);
    answers.push({
      question_id: question.id,
      topic: question.topic,
      answer: facts.length ? facts.map((fact) => fact.answer).join(' ') : 'No founder preference is specified. Choose and label a coherent assumption.',
      fact_ids: facts.map((fact) => fact.id),
    });
  }
  return { task_id: founderIntent.task_id, answers };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [questionsPath, intentPath, outputPath] = process.argv.slice(2);
  if (!questionsPath || !intentPath || !outputPath) {
    console.error('Usage: oracle.mjs <questions.json> <founder-intent.json> <answers.json>');
    process.exit(1);
  }
  const questions = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));
  const intent = JSON.parse(fs.readFileSync(intentPath, 'utf8'));
  fs.writeFileSync(outputPath, `${JSON.stringify(answerQuestions(questions, intent), null, 2)}\n`);
}
