#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  commitPublication as commitPublicationCore,
  installPublication as installPublicationCore,
  preparePublication,
  readPublicationJournal,
  recoverPublication as recoverPublicationCore,
  reservePublication,
  rollbackPublication as rollbackPublicationCore,
  sealPublication as sealPublicationCore,
} from '../scripts/safe-runner/publication.mjs';

const quiescence = {
  quiescenceAuthority: { stopped: true },
  validateQuiescenceAuthority: (authority) => authority.stopped === true,
};
const sealPublication = (handle, options = {}) => sealPublicationCore(handle,
  { ...quiescence, ...options });
const installPublication = (handle, options = {}) => installPublicationCore(handle,
  { ...quiescence, ...options });
const commitPublication = (handle, options = {}) => commitPublicationCore(handle,
  { ...quiescence, ...options });
const rollbackPublication = (handle, options = {}) => rollbackPublicationCore(handle,
  { ...quiescence, ...options });
const recoverPublication = (handle, options = {}) => recoverPublicationCore(handle,
  { ...quiescence, ...options });

const roots = [];
const fixture = (name) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `lamina-publication-${name}-`));
  roots.push(root);
  const repository = path.join(root, 'repository');
  const registry = path.join(root, 'registry');
  fs.mkdirSync(repository, { mode: 0o700 });
  fs.mkdirSync(registry, { mode: 0o700 });
  fs.mkdirSync(path.join(repository, 'out'), { mode: 0o700 });
  return { root, repository, registry };
};
const begin = (item, outputs, options = {}) => {
  const reservation = reservePublication({ registry: item.registry });
  return preparePublication({
    repository: item.repository, reservation, outputs, ...options,
  });
};
const success = {
  successAuthority: { report: 'validated' },
  validateSuccessAuthority: (authority) => authority.report === 'validated',
};
const noTransactions = (item) => assert.deepEqual(fs.readdirSync(item.registry), []);
const crashAt = (expected) => (event) => {
  if (event === expected) throw new Error(`crash:${event}`);
};

try {
  {
    const item = fixture('capability-handle');
    const reservation = reservePublication({ registry: item.registry });
    assert.equal(Object.isFrozen(reservation), true);
    assert.equal(Object.isFrozen(reservation.transaction_identity), true);
    assert.equal(path.dirname(reservation.sentinel), reservation.registry);
    assert.equal(reservation.sentinel.startsWith(`${reservation.transaction}${path.sep}`), false);
    assert.equal(fs.readFileSync(reservation.sentinel, 'utf8').includes(reservation.capability), false);
    assert.throws(() => readPublicationJournal(reservation.transaction), /full pre-registered capability/);
    assert.throws(() => recoverPublicationCore(reservation), /quiescence authority/);
    assert.equal(fs.existsSync(reservation.transaction), true);
    recoverPublication(reservation);
    noTransactions(item);
  }

  {
    const item = fixture('forged-no-journal-handle');
    const reservation = reservePublication({ registry: item.registry });
    const victim = path.join(item.root, 'victim');
    fs.mkdirSync(victim);
    fs.writeFileSync(path.join(victim, 'preserve.txt'), 'preserve');
    const forged = {
      ...reservation,
      transaction: victim,
      transaction_identity: {
        dev: String(fs.lstatSync(victim, { bigint: true }).dev),
        ino: String(fs.lstatSync(victim, { bigint: true }).ino),
        uid: Number(fs.lstatSync(victim, { bigint: true }).uid),
        mode: Number(fs.lstatSync(victim, { bigint: true }).mode & 0o777n),
      },
    };
    assert.throws(() => recoverPublication(forged), /canonically registry-contained/);
    assert.equal(fs.readFileSync(path.join(victim, 'preserve.txt'), 'utf8'), 'preserve');
    recoverPublication(reservation);
    noTransactions(item);
  }

  {
    const item = fixture('pure-absent-file');
    const publication = begin(item, [
      { target: 'out/result.txt', type: 'file', mode: 'pure-output' },
    ]);
    fs.writeFileSync(publication.outputs[0].stage, 'published');
    assert.equal(sealPublication(publication).state, 'prepared');
    assert.equal(installPublication(publication).state, 'new_installed');
    assert.equal(fs.readFileSync(path.join(item.repository, 'out/result.txt'), 'utf8'), 'published');
    assert.equal(commitPublication(publication, success).status, 'committed');
    assert.equal(commitPublication(publication, success).status, 'absent');
    noTransactions(item);
  }

  {
    const item = fixture('pure-existing-file');
    const target = path.join(item.repository, 'out/result.txt');
    fs.writeFileSync(target, 'old');
    fs.chmodSync(target, 0o4755);
    const publication = begin(item, [
      { target: 'out/result.txt', type: 'file', mode: 'pure-output' },
    ]);
    assert.equal(fs.existsSync(publication.outputs[0].stage), false);
    fs.writeFileSync(publication.outputs[0].stage, 'new');
    sealPublication(publication);
    installPublication(publication);
    assert.equal(rollbackPublication(publication).status, 'rolled_back');
    assert.equal(fs.readFileSync(target, 'utf8'), 'old');
    assert.equal(fs.lstatSync(target).mode & 0o7777, 0o4755);
    assert.equal(rollbackPublication(publication).status, 'absent');
    noTransactions(item);
  }

  {
    const item = fixture('pure-directory');
    const publication = begin(item, [
      { target: 'out/tree', type: 'directory', mode: 'pure-output' },
    ]);
    fs.mkdirSync(path.join(publication.outputs[0].stage, 'nested'));
    fs.writeFileSync(path.join(publication.outputs[0].stage, 'nested/value.txt'), 'tree');
    sealPublication(publication);
    installPublication(publication);
    commitPublication(publication, success);
    assert.equal(fs.readFileSync(path.join(item.repository, 'out/tree/nested/value.txt'), 'utf8'),
      'tree');
    noTransactions(item);
  }

  {
    const item = fixture('copy-on-write-modes');
    const target = path.join(item.repository, 'out/tree');
    fs.mkdirSync(target, { mode: 0o750 });
    fs.writeFileSync(path.join(target, 'plain.txt'), 'plain', { mode: 0o640 });
    fs.writeFileSync(path.join(target, 'run.sh'), '#!/bin/sh\n', { mode: 0o751 });
    fs.symlinkSync('plain.txt', path.join(target, 'internal-link'));
    const publication = begin(item, [
      { target: 'out/tree', type: 'directory', mode: 'copy-on-write' },
    ]);
    const stage = publication.outputs[0].stage;
    assert.equal(fs.lstatSync(stage).mode & 0o777, 0o750);
    assert.equal(fs.lstatSync(path.join(stage, 'plain.txt')).mode & 0o777, 0o640);
    assert.equal(fs.lstatSync(path.join(stage, 'run.sh')).mode & 0o777, 0o751);
    fs.writeFileSync(path.join(stage, 'plain.txt'), 'changed');
    sealPublication(publication);
    installPublication(publication);
    installPublication(publication);
    sealPublication(publication);
    commitPublication(publication, success);
    assert.equal(fs.readFileSync(path.join(target, 'plain.txt'), 'utf8'), 'changed');
    assert.equal(fs.lstatSync(path.join(target, 'run.sh')).mode & 0o777, 0o751);
    assert.equal(fs.readlinkSync(path.join(target, 'internal-link')), 'plain.txt');
    noTransactions(item);
  }

  {
    const item = fixture('pure-special-mode-sanitized');
    const target = path.join(item.repository, 'out/result.sh');
    const publication = begin(item, [
      { target: 'out/result.sh', type: 'file', mode: 'pure-output' },
    ]);
    fs.writeFileSync(publication.outputs[0].stage, '#!/bin/sh\n');
    fs.chmodSync(publication.outputs[0].stage, 0o4755);
    sealPublication(publication);
    assert.equal(fs.lstatSync(publication.outputs[0].stage).mode & 0o7777, 0o755);
    installPublication(publication);
    commitPublication(publication, success);
    assert.equal(fs.lstatSync(target).mode & 0o7777, 0o755);
    noTransactions(item);
  }

  {
    const item = fixture('cow-special-modes-sanitized');
    const target = path.join(item.repository, 'out/tree');
    fs.mkdirSync(target, { mode: 0o750 });
    fs.writeFileSync(path.join(target, 'run.sh'), '#!/bin/sh\n', { mode: 0o751 });
    const publication = begin(item, [
      { target: 'out/tree', type: 'directory', mode: 'copy-on-write' },
    ]);
    fs.chmodSync(publication.outputs[0].stage, 0o2750);
    fs.chmodSync(path.join(publication.outputs[0].stage, 'run.sh'), 0o4751);
    sealPublication(publication);
    assert.equal(fs.lstatSync(publication.outputs[0].stage).mode & 0o7777, 0o750);
    assert.equal(fs.lstatSync(path.join(publication.outputs[0].stage, 'run.sh')).mode & 0o7777,
      0o751);
    installPublication(publication);
    commitPublication(publication, success);
    assert.equal(fs.lstatSync(target).mode & 0o7000, 0);
    assert.equal(fs.lstatSync(path.join(target, 'run.sh')).mode & 0o7000, 0);
    noTransactions(item);
  }

  {
    const item = fixture('post-seal-special-mode-mutation');
    const publication = begin(item, [
      { target: 'out/result.sh', type: 'file', mode: 'pure-output' },
    ]);
    fs.writeFileSync(publication.outputs[0].stage, '#!/bin/sh\n', { mode: 0o755 });
    sealPublication(publication);
    fs.chmodSync(publication.outputs[0].stage, 0o4755);
    assert.throws(() => installPublication(publication), /sealed publication payload changed/);
    fs.chmodSync(publication.outputs[0].stage, 0o755);
    rollbackPublication(publication);
    noTransactions(item);
  }

  {
    const item = fixture('payload-discard');
    const publication = begin(item, [
      { target: 'out/failed.txt', type: 'file', mode: 'pure-output' },
    ]);
    fs.writeFileSync(publication.outputs[0].stage, 'partial failure');
    assert.equal(rollbackPublication(publication).status, 'rolled_back');
    assert.equal(fs.existsSync(path.join(item.repository, 'out/failed.txt')), false);
    noTransactions(item);
  }

  {
    const item = fixture('reserved-partial-no-journal');
    const reservation = reservePublication({ registry: item.registry });
    fs.mkdirSync(path.join(reservation.transaction, 'partial'));
    fs.writeFileSync(path.join(reservation.transaction, 'partial/value'), 'partial');
    assert.equal(recoverPublication(reservation).status, 'discarded_prepare');
    assert.equal(fs.existsSync(reservation.transaction), false);
    noTransactions(item);
  }

  for (const event of ['before_initial_prepared_write', 'after_initial_prepared_write']) {
    const item = fixture(event);
    const target = path.join(item.repository, 'out/value.txt');
    fs.writeFileSync(target, 'old');
    const reservation = reservePublication({ registry: item.registry });
    assert.throws(() => preparePublication({
      repository: item.repository, reservation,
      outputs: [{ target: 'out/value.txt', type: 'file', mode: 'copy-on-write' }],
      crashHook: crashAt(event),
    }), new RegExp(`crash:${event}`));
    assert.equal(fs.existsSync(reservation.transaction), true);
    recoverPublication(reservation);
    assert.equal(fs.readFileSync(target, 'utf8'), 'old');
    noTransactions(item);
  }

  for (const event of ['before_sealed_prepared_write', 'after_sealed_prepared_write']) {
    const item = fixture(event);
    const target = path.join(item.repository, 'out/value.txt');
    fs.writeFileSync(target, 'old');
    const publication = begin(item, [
      { target: 'out/value.txt', type: 'file', mode: 'copy-on-write' },
    ]);
    fs.writeFileSync(publication.outputs[0].stage, 'new');
    assert.throws(() => sealPublication(publication, { crashHook: crashAt(event) }),
      new RegExp(`crash:${event}`));
    recoverPublication(publication);
    assert.equal(fs.readFileSync(target, 'utf8'), 'old');
    noTransactions(item);
  }

  {
    const item = fixture('fixed-journal-next');
    const publication = begin(item, [
      { target: 'out/value.txt', type: 'file', mode: 'pure-output' },
    ]);
    fs.writeFileSync(publication.outputs[0].stage, 'new');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assert.throws(() => sealPublication(publication, {
        crashHook: crashAt('after_journal_next_fsync'),
      }), /crash:after_journal_next_fsync/);
      const names = fs.readdirSync(publication.transaction);
      assert.equal(names.filter((name) => name === 'journal.next').length, 1);
      assert.equal(names.some((name) => /^\.journal-.*\.tmp$/.test(name)), false);
      assert.equal(readPublicationJournal(publication).sealed, false);
    }
    assert.equal(sealPublication(publication).sealed, true);
    assert.equal(fs.existsSync(path.join(publication.transaction, 'journal.next')), false);
    recoverPublication(publication);
    noTransactions(item);
  }

  const installCrashEvents = [
    'before_old_rename:0', 'after_old_rename:0',
    'before_old_saved_write', 'after_old_saved_write',
    'before_new_rename:0', 'after_new_rename:0',
    'before_new_installed_write', 'after_new_installed_write',
  ];
  for (const event of installCrashEvents) {
    const item = fixture(event);
    const target = path.join(item.repository, 'out/value.txt');
    fs.writeFileSync(target, 'old');
    const publication = begin(item, [
      { target: 'out/value.txt', type: 'file', mode: 'copy-on-write' },
    ]);
    fs.writeFileSync(publication.outputs[0].stage, 'new');
    sealPublication(publication);
    assert.throws(() => installPublication(publication, { crashHook: crashAt(event) }),
      new RegExp(`crash:${event}`));
    recoverPublication(publication);
    assert.equal(fs.readFileSync(target, 'utf8'), 'old', event);
    noTransactions(item);
  }

  for (const event of ['after_old_rename:0', 'after_new_rename:0']) {
    const item = fixture(`two-output-${event}`);
    const targets = ['first.txt', 'second.txt'].map((name) => path.join(item.repository, 'out', name));
    fs.writeFileSync(targets[0], 'old-first');
    fs.writeFileSync(targets[1], 'old-second');
    const publication = begin(item, [
      { target: 'out/first.txt', type: 'file', mode: 'copy-on-write' },
      { target: 'out/second.txt', type: 'file', mode: 'copy-on-write' },
    ]);
    fs.writeFileSync(publication.outputs[0].stage, 'new-first');
    fs.writeFileSync(publication.outputs[1].stage, 'new-second');
    sealPublication(publication);
    assert.throws(() => installPublication(publication, { crashHook: crashAt(event) }),
      new RegExp(`crash:${event}`));
    recoverPublication(publication);
    assert.equal(fs.readFileSync(targets[0], 'utf8'), 'old-first');
    assert.equal(fs.readFileSync(targets[1], 'utf8'), 'old-second');
    noTransactions(item);
  }

  {
    const item = fixture('before-old-hook-target-mutation');
    const target = path.join(item.repository, 'out/value.txt');
    fs.writeFileSync(target, 'old');
    const publication = begin(item, [
      { target: 'out/value.txt', type: 'file', mode: 'copy-on-write' },
    ]);
    fs.writeFileSync(publication.outputs[0].stage, 'new');
    sealPublication(publication);
    assert.throws(() => installPublication(publication, {
      crashHook: (event) => {
        if (event === 'before_old_rename:0') fs.writeFileSync(target, 'tampered');
      },
    }), /exact prestate changed before old save/);
    fs.writeFileSync(target, 'old');
    rollbackPublication(publication);
    noTransactions(item);
  }

  {
    const item = fixture('before-new-hook-stage-mutation');
    const target = path.join(item.repository, 'out/value.txt');
    fs.writeFileSync(target, 'old');
    const publication = begin(item, [
      { target: 'out/value.txt', type: 'file', mode: 'copy-on-write' },
    ]);
    fs.writeFileSync(publication.outputs[0].stage, 'new');
    sealPublication(publication);
    assert.throws(() => installPublication(publication, {
      crashHook: (event) => {
        if (event === 'before_new_rename:0') {
          fs.writeFileSync(publication.outputs[0].stage, 'tampered');
        }
      },
    }), /sealed stage changed before install/);
    fs.writeFileSync(publication.outputs[0].stage, 'new');
    rollbackPublication(publication);
    assert.equal(fs.readFileSync(target, 'utf8'), 'old');
    noTransactions(item);
  }

  {
    const item = fixture('before-new-hook-parent-mutation');
    const target = path.join(item.repository, 'out/value.txt');
    const parent = path.dirname(target);
    fs.writeFileSync(target, 'old');
    const publication = begin(item, [
      { target: 'out/value.txt', type: 'file', mode: 'copy-on-write' },
    ]);
    fs.writeFileSync(publication.outputs[0].stage, 'new');
    sealPublication(publication);
    assert.throws(() => installPublication(publication, {
      crashHook: (event) => {
        if (event === 'before_new_rename:0') fs.chmodSync(parent, 0o755);
      },
    }), /ancestor identity changed/);
    fs.chmodSync(parent, 0o700);
    rollbackPublication(publication);
    assert.equal(fs.readFileSync(target, 'utf8'), 'old');
    noTransactions(item);
  }

  {
    const item = fixture('post-old-rename-mismatch-preserved');
    const target = path.join(item.repository, 'out/value.txt');
    fs.writeFileSync(target, 'old');
    const publication = begin(item, [
      { target: 'out/value.txt', type: 'file', mode: 'copy-on-write' },
    ]);
    fs.writeFileSync(publication.outputs[0].stage, 'new');
    sealPublication(publication);
    const saved = path.join(publication.transaction, 'old/0/payload');
    assert.throws(() => installPublication(publication, {
      crashHook: (event) => {
        if (event === 'after_old_rename:0') fs.writeFileSync(saved, 'corrupted');
      },
    }), /saved prestate changed after old save/);
    assert.equal(fs.existsSync(target), false);
    assert.equal(fs.existsSync(publication.transaction), true);
    fs.writeFileSync(saved, 'old');
    recoverPublication(publication);
    assert.equal(fs.readFileSync(target, 'utf8'), 'old');
    noTransactions(item);
  }

  {
    const item = fixture('directory-old-rename-crash');
    const target = path.join(item.repository, 'out/tree');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'old.txt'), 'old');
    const publication = begin(item, [
      { target: 'out/tree', type: 'directory', mode: 'copy-on-write' },
    ]);
    fs.writeFileSync(path.join(publication.outputs[0].stage, 'new.txt'), 'new');
    sealPublication(publication);
    assert.throws(() => installPublication(publication, {
      crashHook: crashAt('after_old_rename:0'),
    }), /crash:after_old_rename:0/);
    recoverPublication(publication);
    assert.equal(fs.readFileSync(path.join(target, 'old.txt'), 'utf8'), 'old');
    noTransactions(item);
  }

  const rollbackCrashEvents = [
    'before_rollback_started_write', 'after_rollback_started_write',
    'before_rollback_new_rename:0', 'after_rollback_new_rename:0',
    'before_rollback_old_rename:0', 'after_rollback_old_rename:0',
    'before_rollback_restored_write', 'after_rollback_restored_write',
  ];
  for (const event of rollbackCrashEvents) {
    const item = fixture(event);
    const target = path.join(item.repository, 'out/value.txt');
    fs.writeFileSync(target, 'old');
    const publication = begin(item, [
      { target: 'out/value.txt', type: 'file', mode: 'copy-on-write' },
    ]);
    fs.writeFileSync(publication.outputs[0].stage, 'new');
    sealPublication(publication);
    installPublication(publication);
    assert.throws(() => rollbackPublication(publication, { crashHook: crashAt(event) }),
      new RegExp(`crash:${event}`));
    recoverPublication(publication);
    assert.equal(fs.readFileSync(target, 'utf8'), 'old', event);
    noTransactions(item);
  }

  {
    const item = fixture('tampered-restored-target');
    const target = path.join(item.repository, 'out/value.txt');
    fs.writeFileSync(target, 'old');
    const publication = begin(item, [
      { target: 'out/value.txt', type: 'file', mode: 'copy-on-write' },
    ]);
    fs.writeFileSync(publication.outputs[0].stage, 'new');
    sealPublication(publication);
    installPublication(publication);
    assert.throws(() => rollbackPublication(publication, {
      crashHook: crashAt('after_rollback_restored_write'),
    }), /crash:after_rollback_restored_write/);
    fs.writeFileSync(target, 'tampered');
    assert.throws(() => recoverPublication(publication), /restored target changed/);
    assert.equal(fs.existsSync(publication.transaction), true);
    fs.writeFileSync(target, 'old');
    recoverPublication(publication);
    noTransactions(item);
  }

  {
    const item = fixture('rollback-monotonic');
    const target = path.join(item.repository, 'out/value.txt');
    fs.writeFileSync(target, 'old');
    const publication = begin(item, [
      { target: 'out/value.txt', type: 'file', mode: 'copy-on-write' },
    ]);
    fs.writeFileSync(publication.outputs[0].stage, 'new');
    sealPublication(publication);
    installPublication(publication);
    assert.throws(() => rollbackPublication(publication, {
      crashHook: crashAt('after_rollback_started_write'),
    }), /crash:after_rollback_started_write/);
    assert.equal(readPublicationJournal(publication).rollback_started, true);
    assert.throws(() => commitPublication(publication, success), /refuses after rollback has started/);
    assert.throws(() => installPublication(publication), /refuses after rollback has started/);
    assert.throws(() => sealPublication(publication), /refuses after rollback has started/);
    recoverPublication(publication, success);
    assert.equal(fs.readFileSync(target, 'utf8'), 'old');
    noTransactions(item);
  }

  for (const event of ['before_committed_write', 'after_committed_write']) {
    const item = fixture(event);
    const target = path.join(item.repository, 'out/value.txt');
    fs.writeFileSync(target, 'old');
    const publication = begin(item, [
      { target: 'out/value.txt', type: 'file', mode: 'copy-on-write' },
    ]);
    fs.writeFileSync(publication.outputs[0].stage, 'new');
    sealPublication(publication);
    installPublication(publication);
    assert.throws(() => commitPublication(publication, { ...success, crashHook: crashAt(event) }),
      new RegExp(`crash:${event}`));
    recoverPublication(publication);
    assert.equal(fs.readFileSync(target, 'utf8'),
      event === 'after_committed_write' ? 'new' : 'old');
    noTransactions(item);
  }

  {
    const item = fixture('validated-recovery-commit');
    const target = path.join(item.repository, 'out/value.txt');
    fs.writeFileSync(target, 'old');
    const publication = begin(item, [
      { target: 'out/value.txt', type: 'file', mode: 'copy-on-write' },
    ]);
    fs.writeFileSync(publication.outputs[0].stage, 'new');
    sealPublication(publication);
    installPublication(publication);
    recoverPublication(publication, success);
    assert.equal(fs.readFileSync(target, 'utf8'), 'new');
    noTransactions(item);
  }

  for (const mode of ['rollback', 'commit']) {
    const item = fixture(`${mode}-cleanup-crash`);
    const target = path.join(item.repository, 'out/tree');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'a.txt'), 'old-a');
    fs.writeFileSync(path.join(target, 'b.txt'), 'old-b');
    const publication = begin(item, [
      { target: 'out/tree', type: 'directory', mode: 'copy-on-write' },
    ]);
    fs.writeFileSync(path.join(publication.outputs[0].stage, 'a.txt'), 'new-a');
    fs.writeFileSync(path.join(publication.outputs[0].stage, 'c.txt'), 'new-c');
    sealPublication(publication);
    installPublication(publication);
    let injected = false;
    const cleanupCrash = (event) => {
      if (!injected && event.startsWith('after_cleanup_remove:')) {
        injected = true;
        throw new Error(`crash:${event}`);
      }
    };
    assert.throws(() => mode === 'commit'
      ? commitPublication(publication, { ...success, crashHook: cleanupCrash })
      : rollbackPublication(publication, { crashHook: cleanupCrash }), /crash:after_cleanup_remove/);
    recoverPublication(publication);
    assert.equal(fs.readFileSync(path.join(target, 'a.txt'), 'utf8'),
      mode === 'commit' ? 'new-a' : 'old-a');
    noTransactions(item);
  }

  {
    const item = fixture('tampered-target');
    const target = path.join(item.repository, 'out/value.txt');
    fs.writeFileSync(target, 'old');
    const publication = begin(item, [
      { target: 'out/value.txt', type: 'file', mode: 'copy-on-write' },
    ]);
    fs.writeFileSync(publication.outputs[0].stage, 'new');
    sealPublication(publication);
    installPublication(publication);
    fs.writeFileSync(target, 'tampered');
    assert.throws(() => installPublication(publication), /installed state is ambiguous/);
    assert.throws(() => recoverPublication(publication), /unknown target|recorded new state|prestate/);
  }

  {
    const item = fixture('tampered-ancestor');
    const target = path.join(item.repository, 'out/value.txt');
    fs.writeFileSync(target, 'old');
    const publication = begin(item, [
      { target: 'out/value.txt', type: 'file', mode: 'copy-on-write' },
    ]);
    fs.writeFileSync(publication.outputs[0].stage, 'new');
    sealPublication(publication);
    fs.chmodSync(path.join(item.repository, 'out'), 0o755);
    assert.throws(() => installPublication(publication), /ancestor identity changed/);
    fs.chmodSync(path.join(item.repository, 'out'), 0o700);
    rollbackPublication(publication);
    noTransactions(item);
  }

  {
    const item = fixture('tampered-transaction-slot');
    const publication = begin(item, [
      { target: 'out/value.txt', type: 'file', mode: 'pure-output' },
    ]);
    fs.writeFileSync(publication.outputs[0].stage, 'new');
    const oldSlot = path.join(publication.transaction, 'old/0');
    const savedSlot = path.join(publication.transaction, 'old/original-slot');
    const outside = path.join(item.root, 'outside-slot');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'marker'), 'untouched');
    fs.renameSync(oldSlot, savedSlot);
    fs.symlinkSync(outside, oldSlot);
    assert.throws(() => sealPublication(publication), /old slot 0 identity changed/);
    assert.equal(fs.readFileSync(path.join(outside, 'marker'), 'utf8'), 'untouched');
    fs.unlinkSync(oldSlot);
    fs.renameSync(savedSlot, oldSlot);
    rollbackPublication(publication);
    noTransactions(item);
  }

  {
    const item = fixture('tampered-journal');
    const publication = begin(item, [
      { target: 'out/value.txt', type: 'file', mode: 'pure-output' },
    ]);
    const journal = path.join(publication.transaction, 'journal.json');
    const original = fs.readFileSync(journal);
    fs.appendFileSync(journal, 'tampered');
    assert.throws(() => recoverPublication(publication), /journal JSON is invalid/);
    fs.writeFileSync(journal, original);
    rollbackPublication(publication);
    noTransactions(item);
  }

  {
    const item = fixture('journal-capability-binding');
    const first = begin(item, [
      { target: 'out/first.txt', type: 'file', mode: 'pure-output' },
    ]);
    const second = begin(item, [
      { target: 'out/second.txt', type: 'file', mode: 'pure-output' },
    ]);
    const firstJournal = fs.readFileSync(path.join(first.transaction, 'journal.json'));
    const secondJournalPath = path.join(second.transaction, 'journal.json');
    const secondJournal = fs.readFileSync(secondJournalPath);
    fs.writeFileSync(secondJournalPath, firstJournal);
    assert.throws(() => readPublicationJournal(second), /journal authentication failed/);

    const forged = JSON.parse(firstJournal.toString('utf8'));
    const secondRecord = JSON.parse(secondJournal.toString('utf8'));
    forged.body.transactionId = secondRecord.body.transactionId;
    forged.body.transaction = secondRecord.body.transaction;
    forged.body.registry = secondRecord.body.registry;
    forged.body.transaction_identity = secondRecord.body.transaction_identity;
    forged.body.registry_identity = secondRecord.body.registry_identity;
    forged.mac = crypto.createHash('sha256').update(JSON.stringify(forged.body)).digest('hex');
    forged.checksum = forged.mac;
    fs.writeFileSync(secondJournalPath, `${JSON.stringify(forged)}\n`);
    assert.throws(() => readPublicationJournal(second), /journal authentication failed/);

    fs.writeFileSync(secondJournalPath, secondJournal);
    rollbackPublication(first);
    rollbackPublication(second);
    noTransactions(item);
  }

  {
    const item = fixture('multi-link-journal');
    const publication = begin(item, [
      { target: 'out/value.txt', type: 'file', mode: 'pure-output' },
    ]);
    const journal = path.join(publication.transaction, 'journal.json');
    const externalLink = path.join(item.root, 'journal-link');
    fs.linkSync(journal, externalLink);
    assert.throws(() => recoverPublication(publication), /bounded physical same-user file/);
    fs.unlinkSync(externalLink);
    rollbackPublication(publication);
    noTransactions(item);
  }

  {
    const item = fixture('missing-repository-is-not-missing-journal');
    const publication = begin(item, [
      { target: 'out/value.txt', type: 'file', mode: 'pure-output' },
    ]);
    const moved = `${item.repository}-moved`;
    fs.renameSync(item.repository, moved);
    assert.throws(() => recoverPublication(publication), /ENOENT/);
    assert.equal(fs.existsSync(publication.transaction), true);
    fs.renameSync(moved, item.repository);
    rollbackPublication(publication);
    noTransactions(item);
  }

  for (const [name, limits, construct, pattern] of [
    ['bytes', { maxBytes: 3 }, (stage) => fs.writeFileSync(stage, 'four'), /byte\/inode budget/],
    ['inodes', { maxInodes: 2 }, (stage) => {
      fs.writeFileSync(path.join(stage, 'a'), ''); fs.writeFileSync(path.join(stage, 'b'), '');
    }, /inode bound|byte\/inode budget/],
    ['depth', { maxDepth: 1 }, (stage) => {
      fs.mkdirSync(path.join(stage, 'a')); fs.mkdirSync(path.join(stage, 'a/b'));
    }, /bounded depth/],
  ]) {
    const item = fixture(`bound-${name}`);
    const type = name === 'bytes' ? 'file' : 'directory';
    const publication = begin(item, [
      { target: `out/${name}`, type, mode: 'pure-output' },
    ], { limits });
    construct(publication.outputs[0].stage);
    assert.throws(() => sealPublication(publication), pattern);
    rollbackPublication(publication);
    noTransactions(item);
  }

  {
    const item = fixture('output-bound');
    const reservation = reservePublication({ registry: item.registry });
    const outputs = Array.from({ length: 257 }, (_, index) => ({
      target: `out/value-${index}.txt`, type: 'file', mode: 'pure-output',
    }));
    assert.throws(() => preparePublication({
      repository: item.repository, reservation, outputs,
    }), /hard 256-output bound/);
    assert.equal(recoverPublication(reservation).status, 'absent');
    noTransactions(item);
  }

  {
    const item = fixture('registry-contains-target');
    const marker = path.join(item.repository, 'out/marker');
    fs.writeFileSync(marker, 'preserve');
    const reservation = reservePublication({ registry: item.repository });
    assert.throws(() => preparePublication({
      repository: item.repository, reservation,
      outputs: [{ target: 'out/value.txt', type: 'file', mode: 'pure-output' }],
    }), /output and registry authority overlap/);
    assert.equal(fs.existsSync(path.join(reservation.transaction, 'stage')), false);
    assert.equal(recoverPublication(reservation).status, 'discarded_prepare');
    assert.equal(fs.readFileSync(marker, 'utf8'), 'preserve');
    assert.equal(fs.existsSync(reservation.transaction), false);
    assert.equal(fs.existsSync(reservation.sentinel), false);
  }

  {
    const item = fixture('target-contains-registry');
    const target = path.join(item.repository, 'out/tree');
    const nestedRegistry = path.join(target, 'registry');
    fs.mkdirSync(target);
    fs.mkdirSync(nestedRegistry);
    const marker = path.join(target, 'marker');
    fs.writeFileSync(marker, 'preserve');
    const reservation = reservePublication({ registry: nestedRegistry });
    assert.throws(() => preparePublication({
      repository: item.repository, reservation,
      outputs: [{ target: 'out/tree', type: 'directory', mode: 'pure-output' }],
    }), /output and registry authority overlap/);
    assert.equal(fs.existsSync(path.join(reservation.transaction, 'stage')), false);
    recoverPublication(reservation);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'preserve');
    assert.deepEqual(fs.readdirSync(nestedRegistry), []);
  }

  {
    const item = fixture('target-equals-registry');
    const nestedRegistry = path.join(item.repository, 'out/registry');
    fs.mkdirSync(nestedRegistry);
    const marker = path.join(nestedRegistry, 'marker');
    fs.writeFileSync(marker, 'preserve');
    const reservation = reservePublication({ registry: nestedRegistry });
    assert.throws(() => preparePublication({
      repository: item.repository, reservation,
      outputs: [{ target: 'out/registry', type: 'directory', mode: 'pure-output' }],
    }), /output and registry authority overlap/);
    assert.equal(fs.existsSync(path.join(reservation.transaction, 'stage')), false);
    recoverPublication(reservation);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'preserve');
    assert.deepEqual(fs.readdirSync(nestedRegistry), ['marker']);
  }

  for (const kind of ['external-symlink', 'dangling-symlink', 'hardlink', 'special']) {
    const item = fixture(kind);
    const publication = begin(item, [
      { target: `out/${kind}`, type: 'directory', mode: 'pure-output' },
    ]);
    const stage = publication.outputs[0].stage;
    const file = path.join(stage, 'file');
    fs.writeFileSync(file, 'value');
    if (kind === 'external-symlink') {
      const outside = path.join(item.root, 'outside');
      fs.writeFileSync(outside, 'outside');
      fs.symlinkSync(path.relative(stage, outside), path.join(stage, 'bad'));
    }
    if (kind === 'dangling-symlink') fs.symlinkSync('missing', path.join(stage, 'bad'));
    if (kind === 'hardlink') fs.linkSync(file, path.join(stage, 'hard'));
    if (kind === 'special') {
      const fifo = spawnSync('mkfifo', [path.join(stage, 'fifo')], { encoding: 'utf8' });
      assert.equal(fifo.status, 0, fifo.stderr);
    }
    assert.throws(() => sealPublication(publication),
      kind.includes('symlink') ? /symlink/ : kind === 'hardlink' ? /multi-link/ : /special file/);
    rollbackPublication(publication);
    noTransactions(item);
  }

  {
    const item = fixture('cross-device');
    let external = null;
    try { external = fs.mkdtempSync('/dev/shm/lamina-publication-registry-'); } catch {}
    if (external) {
      roots.push(external);
      const repositoryDev = String(fs.lstatSync(path.join(item.repository, 'out'), { bigint: true }).dev);
      const registryDev = String(fs.lstatSync(external, { bigint: true }).dev);
      if (repositoryDev !== registryDev) {
        const reservation = reservePublication({ registry: external });
        assert.throws(() => preparePublication({
          repository: item.repository, reservation,
          outputs: [{ target: 'out/value.txt', type: 'file', mode: 'pure-output' }],
        }), /cross-device/);
        assert.equal(fs.existsSync(reservation.transaction), false);
      }
    }
  }

  {
    const item = fixture('journal-states');
    const target = path.join(item.repository, 'out/value.txt');
    fs.writeFileSync(target, 'old');
    const publication = begin(item, [
      { target: 'out/value.txt', type: 'file', mode: 'copy-on-write' },
    ]);
    assert.equal(readPublicationJournal(publication).state, 'prepared');
    fs.writeFileSync(publication.outputs[0].stage, 'new');
    sealPublication(publication);
    installPublication(publication, {
      crashHook: (event) => {
        if (event === 'after_old_saved_write') {
          assert.equal(readPublicationJournal(publication).state, 'old_saved');
        }
      },
    });
    assert.equal(readPublicationJournal(publication).state, 'new_installed');
    rollbackPublication(publication);
    noTransactions(item);
  }

  console.log('safe-runner publication contracts passed');
} finally {
  for (const root of roots.reverse()) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
}
