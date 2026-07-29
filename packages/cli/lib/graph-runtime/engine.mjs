import fs from 'node:fs';
import path from 'node:path';
import { Database, Connection, json } from '@ladybugdb/core';
import { EPISTEMIC_BY_INGRESS, ERROR, RESOURCE_KINDS, SCHEMA, VIEW_KINDS } from './constants.mjs';
import { canonical, digest, ensureRuntime, fail, git, repositoryContext, safeJson } from './util.mjs';

// Ladybug treats json(string) as pre-serialized JSON, so serialize every value
// explicitly to preserve scalar string literals as valid JSON.
const graphJson = (value) => json(JSON.stringify(value));

function rows(result) {
  if (Array.isArray(result)) return result.flatMap((item) => item.getAllSync());
  return result.getAllSync();
}

function asArray(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

function statementConflictKey(statement) {
  const { epistemic_class: _epistemicClass, ...semanticQualifiers } = statement.qualifiers || {};
  const functionalObject = statement.predicate === 'lamina:hasStep' ||
    statement.predicate === 'lamina:producedHarnessResult' ||
    semanticQualifiers.cardinality === 'one' ||
    semanticQualifiers.functional === true;
  if (statement.object && !functionalObject) return null;
  return JSON.stringify(canonical({
    subject: statement.subject,
    predicate: statement.predicate,
    scope: statement.scope || null,
    qualifiers: semanticQualifiers,
  }));
}

function statementValueKey(statement) {
  return JSON.stringify(canonical({
    object: statement.object || null,
    literal: statement.object ? null : statement.literal,
  }));
}

function containsEngineOwnedStatus(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsEngineOwnedStatus);
  return Object.entries(value).some(([key, nested]) =>
    ['epistemic_class', 'approved', 'approval_status'].includes(key) ||
    containsEngineOwnedStatus(nested));
}

export class GraphEngine {
  constructor(paths) {
    this.paths = paths;
    ensureRuntime(paths);
    const generationPath = path.join(paths.cocoindex, 'target-generation');
    if (!fs.existsSync(paths.database) || !fs.existsSync(generationPath)) {
      fs.writeFileSync(generationPath, `${digest('generation', { nonce: cryptoRandom(), database: paths.database })}\n`);
    }
    this.database = new Database(paths.database);
    this.connection = new Connection(this.database);
    this.connection.initSync();
    for (const statement of SCHEMA) this.connection.querySync(statement);
  }

  close() {
    this.connection.closeSync();
    this.database.closeSync();
  }

  query(statement, params = {}) {
    const prepared = this.connection.prepareSync(statement);
    if (!prepared.isSuccess()) fail(ERROR.INTERNAL, prepared.getErrorMessage(), { statement });
    return rows(this.connection.executeSync(prepared, params));
  }

  transaction(work) {
    this.connection.querySync('BEGIN TRANSACTION');
    try {
      const result = work();
      this.connection.querySync('COMMIT');
      return result;
    } catch (error) {
      try { this.connection.querySync('ROLLBACK'); } catch {}
      throw error;
    }
  }

  currentContext(cwd) {
    const context = repositoryContext(cwd);
    if (path.resolve(context.common) !== path.resolve(this.paths.common)) {
      fail(ERROR.BAD_REQUEST, 'graphd request belongs to a different Git clone.');
    }
    return context;
  }

  resource(id) {
    return this.query('MATCH (r:Resource {id: $id}) RETURN r.id AS id, r.kind AS kind, r.data AS data', { id })[0] || null;
  }

  resolveResourceId(ref, allowed = null) {
    if (!ref) return null;
    if (this.resource(ref) && (!allowed || allowed.has(ref))) return ref;
    const resolved = this.query(
      'MATCH (a:Alias {key: $key})-[:ALIAS_TO]->(r:Resource) RETURN r.id AS id',
      { key: ref },
    )[0]?.id || null;
    return resolved && (!allowed || allowed.has(resolved)) ? resolved : null;
  }

  view(ref) {
    return this.query(
      'MATCH (v:GraphView) WHERE v.id = $ref OR v.name = $ref RETURN v.id AS id, v.kind AS kind, v.name AS name, v.status AS status',
      { ref },
    )[0] || null;
  }

  head(viewId) {
    return this.query(
      'MATCH (v:GraphView {id: $id})-[:VIEW_HEAD]->(g:GraphVersion) RETURN g.id AS id, g.source_revision AS source_revision, g.receipt AS receipt',
      { id: viewId },
    )[0] || null;
  }

  createResource(input, ingress = 'agent') {
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        (input.data !== undefined && (!input.data || typeof input.data !== 'object' || Array.isArray(input.data)))) {
      fail(ERROR.VALIDATION, 'A Resource and its data must be JSON objects.');
    }
    if (containsEngineOwnedStatus(input)) {
      fail(ERROR.SPOOFED_STATUS, 'Epistemic class and approval are engine-derived.');
    }
    if (!RESOURCE_KINDS.has(input.kind)) fail(ERROR.VALIDATION, `Unknown resource kind: ${input.kind}`);
    const id = input.id || digest('res', { kind: input.kind, data: input.data || {}, alias: input.alias || null });
    const epistemicClass = EPISTEMIC_BY_INGRESS[ingress];
    if (!epistemicClass) fail(ERROR.BAD_REQUEST, `Unknown ingress: ${ingress}`);
    const data = canonical({ ...(input.data || {}), epistemic_class: epistemicClass });
    const existing = this.resource(id);
    if (existing) {
      if (existing.kind !== input.kind || JSON.stringify(canonical(existing.data)) !== JSON.stringify(data)) {
        fail(ERROR.CONFLICT, `Resource identity ${id} already has different content.`);
      }
      return { id, created: false, contradictions: [] };
    }
    this.query('CREATE (r:Resource {id: $id, kind: $kind, data: $data})', { id, kind: input.kind, data: graphJson(data) });
    const contradictions = [];
    for (const alias of asArray(input.aliases || input.alias)) {
      const collision = this.query(
        'MATCH (a:Alias {key: $key})-[:ALIAS_TO]->(r:Resource) RETURN r.id AS id',
        { key: alias },
      )[0];
      if (collision && collision.id !== id) {
        contradictions.push(this.createContradiction('alias_collision', [collision.id, id], { alias }));
      } else if (!collision) {
        this.query('CREATE (a:Alias {key: $key})', { key: alias });
        this.query('MATCH (a:Alias {key: $key}), (r:Resource {id: $id}) CREATE (a)-[:ALIAS_TO]->(r)', { key: alias, id });
      }
    }
    return { id, created: true, contradictions };
  }

  statementIdentity(input) {
    return {
      subject: input.subject,
      predicate: input.predicate,
      object: input.object || null,
      literal: input.object ? null : safeJson(input.literal),
      scope: input.scope || null,
      qualifiers: canonical(input.qualifiers || {}),
    };
  }

  createStatement(input, ingress = 'agent', allowedResources = null) {
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        (input.qualifiers !== undefined &&
          (!input.qualifiers || typeof input.qualifiers !== 'object' || Array.isArray(input.qualifiers)))) {
      fail(ERROR.VALIDATION, 'A Statement and its qualifiers must be JSON objects.');
    }
    if (containsEngineOwnedStatus(input)) {
      fail(ERROR.SPOOFED_STATUS, 'Epistemic class and approval are engine-derived.');
    }
    if (!input.subject || !input.predicate || (!!input.object === (input.literal !== undefined))) {
      fail(ERROR.VALIDATION, 'A Statement needs subject, predicate, and exactly one of object or literal.');
    }
    if (!/^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/.test(input.predicate)) {
      fail(ERROR.VALIDATION, `Statement predicate must be namespaced or an IRI: ${input.predicate}`);
    }
    const subject = this.resolveResourceId(input.subject, allowedResources);
    const object = input.object ? this.resolveResourceId(input.object, allowedResources) : null;
    const scope = input.scope ? this.resolveResourceId(input.scope, allowedResources) : null;
    if (!subject) fail(ERROR.VALIDATION, `Unknown Statement subject: ${input.subject}`);
    if (input.object && !object) fail(ERROR.VALIDATION, `Unknown Statement object: ${input.object}`);
    if (input.scope && !scope) fail(ERROR.VALIDATION, `Unknown Statement scope: ${input.scope}`);
    input = { ...input, subject, object, scope };
    const evidence = asArray(input.evidence);
    for (const evidenceId of evidence) {
      const found = this.resource(evidenceId);
      if (!found || !['evidence', 'observation', 'harness_result'].includes(found.kind)) {
        fail(ERROR.EVIDENCE_MISSING, `Invalid evidence resource: ${evidenceId}`);
      }
    }
    const identity = this.statementIdentity(input);
    const id = digest('stmt', identity);
    const existing = this.query('MATCH (s:Statement {id: $id}) RETURN s.id AS id', { id })[0];
    if (!existing) {
      const epistemicClass = EPISTEMIC_BY_INGRESS[ingress];
      if (!epistemicClass) fail(ERROR.BAD_REQUEST, `Unknown ingress: ${ingress}`);
      const qualifiers = canonical({ ...identity.qualifiers, epistemic_class: epistemicClass });
      this.query(
        'CREATE (s:Statement {id: $id, predicate: $predicate, literal: $literal, qualifiers: $qualifiers})',
        { id, predicate: input.predicate, literal: graphJson(identity.literal), qualifiers: graphJson(qualifiers) },
      );
      this.query('MATCH (s:Statement {id: $id}), (r:Resource {id: $subject}) CREATE (s)-[:STMT_SUBJECT]->(r)', { id, subject: input.subject });
      if (input.object) this.query('MATCH (s:Statement {id: $id}), (r:Resource {id: $object}) CREATE (s)-[:STMT_OBJECT]->(r)', { id, object: input.object });
      if (input.scope) this.query('MATCH (s:Statement {id: $id}), (r:Resource {id: $scope}) CREATE (s)-[:STMT_SCOPE]->(r)', { id, scope: input.scope });
    }
    return { id, created: !existing, evidence };
  }

  createContradiction(type, members, data = {}) {
    const statementMembers = members.filter((id) => id.startsWith('stmt_'));
    const id = digest('contradiction', { type, members: [...members].sort(), data });
    const created = this.createResource({ id, kind: 'contradiction', data: { type, members: [...members].sort(), ...data } }, 'intent');
    for (const statementId of statementMembers) {
      const linked = this.query(
        'MATCH (c:Resource {id: $id})-[:CONFLICT_MEMBER]->(s:Statement {id: $statement}) RETURN s.id AS id',
        { id, statement: statementId },
      )[0];
      if (!linked) this.query('MATCH (c:Resource {id: $id}), (s:Statement {id: $statement}) CREATE (c)-[:CONFLICT_MEMBER]->(s)', { id, statement: statementId });
    }
    return { id, created: created.created };
  }

  ensureBranch(name, sourceRevision) {
    const id = `branch:${name}`;
    let view = this.view(id);
    if (view) return view;
    return this.transaction(() => {
      const inherited = this.nearestVersion(sourceRevision);
      this.query('CREATE (v:GraphView {id: $id, kind: $kind, name: $name, status: $status})', { id, kind: 'branch', name, status: 'active' });
      if (inherited) {
        this.query('MATCH (v:GraphView {id: $view}), (g:GraphVersion {id: $version}) CREATE (v)-[:VIEW_HEAD]->(g)', { view: id, version: inherited.id });
        this.materializeView(id, inherited.receipt);
        return this.view(id);
      }
      const versionId = digest('version', { branch: name, sourceRevision, initial: true, parents: [] });
      this.query('CREATE (g:GraphVersion {id: $id, source_revision: $source, receipt: $receipt})', {
        id: versionId,
        source: sourceRevision,
        receipt: graphJson({ active_resources: [], active_statements: [], validation: { ok: true, approved: true, errors: [], contradictions: [] } }),
      });
      this.query('MATCH (v:GraphView {id: $view}), (g:GraphVersion {id: $version}) CREATE (v)-[:VIEW_HEAD]->(g)', { view: id, version: versionId });
      return this.view(id);
    });
  }

  nearestVersion(revision) {
    const sourceCommit = (value) => value?.startsWith('dirty:')
      ? value.split(':', 3)[1]
      : value;
    if (!revision || revision.startsWith('unborn:')) return null;
    const revisionCommit = sourceCommit(revision);
    let ancestors;
    try { ancestors = git(['rev-list', revisionCommit], this.paths.root); } catch { return null; }
    const distance = new Map(ancestors.split('\n').filter(Boolean).map((sha, index) => [sha, index]));
    const versions = this.query(
      'MATCH (g:GraphVersion) RETURN g.id AS id, g.source_revision AS source_revision, g.receipt AS receipt',
    );
    const branchHeads = new Set(this.query(
      'MATCH (v:GraphView {kind: $kind})-[:VIEW_HEAD]->(g:GraphVersion) RETURN g.id AS id',
      { kind: 'branch' },
    ).map((item) => item.id));
    const parentMap = new Map();
    for (const edge of this.query(
      'MATCH (g:GraphVersion)-[:VERSION_PARENT]->(p:GraphVersion) RETURN g.id AS child, p.id AS parent',
    )) {
      if (!parentMap.has(edge.child)) parentMap.set(edge.child, []);
      parentMap.get(edge.child).push(edge.parent);
    }
    const depthMemo = new Map();
    const graphDepth = (id, visiting = new Set()) => {
      if (depthMemo.has(id)) return depthMemo.get(id);
      if (visiting.has(id)) return 0;
      const nextVisiting = new Set(visiting).add(id);
      const depth = 1 + Math.max(0, ...(parentMap.get(id) || []).map((parent) => graphDepth(parent, nextVisiting)));
      depthMemo.set(id, depth);
      return depth;
    };
    return versions
      .filter((item) => distance.has(sourceCommit(item.source_revision)))
      .sort((left, right) =>
        distance.get(sourceCommit(left.source_revision)) - distance.get(sourceCommit(right.source_revision)) ||
        Number(right.source_revision === revision) - Number(left.source_revision === revision) ||
        Number(branchHeads.has(right.id)) - Number(branchHeads.has(left.id)) ||
        graphDepth(right.id) - graphDepth(left.id) ||
        left.id.localeCompare(right.id))[0] || null;
  }

  graphParents(currentHead, sourceRevision) {
    const parents = new Map([[currentHead.id, currentHead]]);
    if (sourceRevision.startsWith('dirty:') || sourceRevision.startsWith('unborn:')) return [...parents.values()];
    try {
      const [, ...gitParents] = git(['rev-list', '--parents', '-n', '1', sourceRevision], this.paths.root).split(/\s+/);
      if (gitParents.length < 2) return [...parents.values()];
      for (const revision of gitParents) {
        const version = this.nearestVersion(revision);
        if (version) parents.set(version.id, version);
      }
    } catch {}
    return [...parents.values()];
  }

  materializeView(viewId, receipt) {
    this.query('MATCH (v:GraphView {id: $id})-[edge:VIEW_RES]->() DELETE edge', { id: viewId });
    this.query('MATCH (v:GraphView {id: $id})-[edge:VIEW_STMT]->() DELETE edge', { id: viewId });
    for (const resourceId of receipt?.active_resources || []) {
      this.query('MATCH (v:GraphView {id: $view}), (r:Resource {id: $id}) CREATE (v)-[:VIEW_RES]->(r)', { view: viewId, id: resourceId });
    }
    for (const statementId of receipt?.active_statements || []) {
      this.query('MATCH (v:GraphView {id: $view}), (s:Statement {id: $id}) CREATE (v)-[:VIEW_STMT]->(s)', { view: viewId, id: statementId });
    }
  }

  startSession({ branch, source_revision: sourceRevision, id }) {
    const branchView = this.ensureBranch(branch, sourceRevision);
    const sessionId = id || digest('session', { branch, sourceRevision, nonce: cryptoRandom() });
    if (this.view(sessionId)) fail(ERROR.CONFLICT, `Session already exists: ${sessionId}`);
    this.transaction(() => {
      this.query('CREATE (s:GraphView {id: $id, kind: $kind, name: $name, status: $status})', {
        id: sessionId, kind: 'session', name: sessionId, status: 'active',
      });
      this.query('MATCH (s:GraphView {id: $session}), (b:GraphView {id: $branch}) CREATE (s)-[:VIEW_BASE]->(b)', { session: sessionId, branch: branchView.id });
      const head = this.head(branchView.id);
      this.query('MATCH (s:GraphView {id: $session}), (g:GraphVersion {id: $head}) CREATE (s)-[:VIEW_HEAD]->(g)', { session: sessionId, head: head.id });
      this.materializeView(sessionId, head.receipt);
    });
    return this.session(sessionId);
  }

  session(id) {
    const view = this.view(id);
    if (!view || view.kind !== 'session') fail(ERROR.NOT_FOUND, `Session not found: ${id}`);
    const base = this.query('MATCH (s:GraphView {id: $id})-[:VIEW_BASE]->(b:GraphView) RETURN b.id AS id, b.name AS name', { id })[0];
    return { ...view, base, base_version: this.head(id) };
  }

  stageResource(sessionId, input, ingress = 'agent') {
    const session = this.session(sessionId);
    if (session.status !== 'active') fail(ERROR.CONFLICT, `Session is ${session.status}`);
    return this.transaction(() => {
      const result = this.createResource(input, ingress);
      const linked = this.query('MATCH (v:GraphView {id: $view})-[:VIEW_RES]->(r:Resource {id: $id}) RETURN r.id AS id', { view: sessionId, id: result.id })[0];
      if (!linked) this.query('MATCH (v:GraphView {id: $view}), (r:Resource {id: $id}) CREATE (v)-[:VIEW_RES]->(r)', { view: sessionId, id: result.id });
      for (const contradiction of result.contradictions) {
        const contradictionId = contradiction.id;
        const staged = this.query(
          'MATCH (v:GraphView {id: $view})-[:VIEW_RES]->(r:Resource {id: $id}) RETURN r.id AS id',
          { view: sessionId, id: contradictionId },
        )[0];
        if (!staged) {
          this.query(
            'MATCH (v:GraphView {id: $view}), (r:Resource {id: $id}) CREATE (v)-[:VIEW_RES]->(r)',
            { view: sessionId, id: contradictionId },
          );
        }
      }
      return result;
    });
  }

  stageStatement(sessionId, input, ingress = 'agent') {
    const session = this.session(sessionId);
    if (session.status !== 'active') fail(ERROR.CONFLICT, `Session is ${session.status}`);
    return this.transaction(() => {
      const result = this.createStatement(input, ingress, this.activeIds(sessionId).resources);
      const linked = this.query('MATCH (v:GraphView {id: $view})-[:VIEW_STMT]->(s:Statement {id: $id}) RETURN s.id AS id', { view: sessionId, id: result.id })[0];
      if (!linked) this.query('MATCH (v:GraphView {id: $view}), (s:Statement {id: $id}) CREATE (v)-[:VIEW_STMT]->(s)', { view: sessionId, id: result.id });
      for (const evidence of result.evidence) {
        const key = digest('support', { session: sessionId, statement: result.id, evidence });
        const pending = this.query(
          'MATCH (v:GraphView {id: $view})-[edge:SESSION_SUPPORT_STMT {key: $key}]->(s:Statement {id: $statement}) RETURN edge.key AS key',
          { view: sessionId, key, statement: result.id },
        )[0];
        if (!pending) {
          this.query(
            'MATCH (v:GraphView {id: $view}), (s:Statement {id: $statement}) CREATE (v)-[:SESSION_SUPPORT_STMT {key: $key}]->(s)',
            { view: sessionId, statement: result.id, key },
          );
          this.query(
            'MATCH (v:GraphView {id: $view}), (r:Resource {id: $evidence}) CREATE (v)-[:SESSION_SUPPORT_EVIDENCE {key: $key}]->(r)',
            { view: sessionId, evidence, key },
          );
        }
      }
      return result;
    });
  }

  retireResource(sessionId, ref) {
    const session = this.session(sessionId);
    if (session.status !== 'active') fail(ERROR.CONFLICT, `Session is ${session.status}`);
    const active = this.activeIds(sessionId);
    const id = this.resolveResourceId(ref, active.resources);
    if (!id) fail(ERROR.NOT_FOUND, `Active Resource not found: ${ref}`);
    this.transaction(() => {
      this.query('MATCH (v:GraphView {id: $view})-[edge:VIEW_RES]->(r:Resource {id: $id}) DELETE edge', {
        view: sessionId,
        id,
      });
    });
    return { id, retired: true };
  }

  retireStatement(sessionId, id) {
    const session = this.session(sessionId);
    if (session.status !== 'active') fail(ERROR.CONFLICT, `Session is ${session.status}`);
    if (!this.activeIds(sessionId).statements.has(id)) fail(ERROR.NOT_FOUND, `Active Statement not found: ${id}`);
    this.transaction(() => {
      this.query('MATCH (v:GraphView {id: $view})-[edge:VIEW_STMT]->(s:Statement {id: $id}) DELETE edge', {
        view: sessionId,
        id,
      });
    });
    return { id, retired: true };
  }

  activeIds(viewId) {
    const view = this.view(viewId);
    if (view?.kind === 'session' || view?.kind === 'observation') {
      const resources = new Set();
      const statements = new Set();
      for (const row of this.query('MATCH (v:GraphView {id: $id})-[:VIEW_RES]->(r:Resource) RETURN r.id AS id', { id: viewId })) {
        resources.add(row.id);
      }
      for (const row of this.query('MATCH (v:GraphView {id: $id})-[:VIEW_STMT]->(s:Statement) RETURN s.id AS id', { id: viewId })) {
        statements.add(row.id);
      }
      return { resources, statements };
    }
    const head = this.head(viewId);
    const receipt = head?.receipt || {};
    const resources = new Set(receipt.active_resources || []);
    const statements = new Set(receipt.active_statements || []);
    return { resources, statements };
  }

  statementDetails(ids) {
    const output = [];
    for (const id of ids) {
      const row = this.query(
        `MATCH (s:Statement {id: $id})-[:STMT_SUBJECT]->(subject:Resource)
         OPTIONAL MATCH (s)-[:STMT_OBJECT]->(object:Resource)
         OPTIONAL MATCH (s)-[:STMT_SCOPE]->(scope:Resource)
         RETURN s.id AS id, subject.id AS subject, s.predicate AS predicate, object.id AS object,
                s.literal AS literal, scope.id AS scope, s.qualifiers AS qualifiers`,
        { id },
      )[0];
      if (row) output.push(row);
    }
    return output;
  }

  validateSet(resourceIds, statementIds, sourceRevision = null) {
    const errors = [];
    const readiness_gaps = [];
    const stale_evidence = [];
    const resources = new Set(resourceIds);
    const resourceRows = [...resources].map((id) => this.resource(id)).filter(Boolean);
    const resourceById = new Map(resourceRows.map((item) => [item.id, item]));
    const statements = this.statementDetails(statementIds);
    const epistemicClasses = new Set(Object.values(EPISTEMIC_BY_INGRESS));
    for (const resource of resourceRows) {
      if (!epistemicClasses.has(resource.data?.epistemic_class)) {
        errors.push(`Resource ${resource.id} has invalid epistemic ingress.`);
      }
    }
    for (const statement of statements) {
      if (!resources.has(statement.subject)) errors.push(`Statement ${statement.id} subject is not active.`);
      if (statement.object && !resources.has(statement.object)) errors.push(`Statement ${statement.id} object is not active.`);
      if (statement.scope && !resources.has(statement.scope)) errors.push(`Statement ${statement.id} scope is not active.`);
      if (!epistemicClasses.has(statement.qualifiers?.epistemic_class)) {
        errors.push(`Statement ${statement.id} has invalid epistemic ingress.`);
      }
      const evidence = this.query(
        'MATCH (s:Statement {id: $id})-[:SUPPORTED_BY]->(r:Resource) RETURN r.id AS id, r.kind AS kind, r.data AS data',
        { id: statement.id },
      );
      for (const item of evidence) {
        if (item.kind === 'observation') {
          const current = this.query(
            'MATCH (v:GraphView {kind: $kind, status: $status})-[:VIEW_RES]->(r:Resource {id: $id}) RETURN v.id AS id',
            { kind: 'observation', status: 'active', id: item.id },
          )[0];
          if (!current) stale_evidence.push({ statement: statement.id, evidence: item.id, reason: 'source observation is no longer current' });
          else if (sourceRevision && item.data?.source_snapshot?.source_revision !== sourceRevision) {
            stale_evidence.push({
              statement: statement.id,
              evidence: item.id,
              reason: 'source observation snapshot does not match the GraphVersion source revision',
            });
          }
        }
        for (const event of item.data?.events || []) {
          if (!event.artifact?.locator || !event.artifact?.digest) continue;
          if (!fs.existsSync(event.artifact.locator)) {
            stale_evidence.push({ statement: statement.id, evidence: item.id, reason: 'artifact is missing' });
          } else {
            const actual = digest('artifact', fs.readFileSync(event.artifact.locator).toString('base64'));
            if (actual !== event.artifact.digest) stale_evidence.push({ statement: statement.id, evidence: item.id, reason: 'artifact digest mismatch' });
          }
        }
      }
    }
    const positions = new Map();
    for (const statement of statements.filter((item) => item.predicate === 'lamina:hasStep')) {
      const position = statement.qualifiers?.position;
      const key = `${statement.subject}:${position}`;
      if (resourceById.get(statement.subject)?.kind !== 'workflow' ||
          resourceById.get(statement.object)?.kind !== 'operation') {
        errors.push(`Workflow step ${statement.id} must link a Workflow to an Operation.`);
      }
      if (!Number.isInteger(position) || position < 1) errors.push(`Workflow step ${statement.id} needs a positive integer position.`);
      else if (positions.has(key)) errors.push(`Workflow ${statement.subject} has duplicate step position ${position}.`);
      positions.set(key, statement.id);
    }
    const workflowPositions = new Map();
    for (const statement of statements.filter((item) => item.predicate === 'lamina:hasStep' &&
      Number.isInteger(item.qualifiers?.position) && item.qualifiers.position > 0)) {
      if (!workflowPositions.has(statement.subject)) workflowPositions.set(statement.subject, []);
      workflowPositions.get(statement.subject).push(statement.qualifiers.position);
    }
    for (const [workflow, values] of workflowPositions) {
      const sorted = [...new Set(values)].sort((a, b) => a - b);
      if (sorted.some((position, index) => position !== index + 1)) {
        errors.push(`Workflow ${workflow} step positions must be contiguous from 1.`);
      }
    }
    for (const workflow of resourceRows.filter((item) => item.kind === 'workflow')) {
      if (!workflowPositions.has(workflow.id)) {
        readiness_gaps.push({
          code: 'workflow_unreachable',
          resource: workflow.id,
          message: `Workflow ${workflow.id} has no ordered operations.`,
        });
      }
    }

    const kindRules = new Map([
      ['lamina:canAssume', ['persona', 'actor']],
      ['lamina:authorizedFor', ['actor', 'operation']],
      ['lamina:requiresProof', [null, 'proof']],
      ['lamina:realizes', ['surface', 'operation']],
      ['lamina:transitionsTo', ['entity', 'entity']],
      ['lamina:supportedBy', [null, null]],
    ]);
    for (const statement of statements) {
      const rule = kindRules.get(statement.predicate);
      if (!rule) continue;
      const subjectKind = resourceById.get(statement.subject)?.kind;
      const objectKind = resourceById.get(statement.object)?.kind;
      if ((rule[0] && subjectKind !== rule[0]) || (rule[1] && objectKind !== rule[1])) {
        errors.push(`Statement ${statement.id} violates the ${statement.predicate} kind contract.`);
      }
      if (statement.subject === statement.object) {
        errors.push(`Statement ${statement.id} cannot be a self-reference.`);
      }
    }

    const detectCycle = (predicate) => {
      const edges = new Map();
      for (const statement of statements.filter((item) => item.predicate === predicate && item.object)) {
        if (!edges.has(statement.subject)) edges.set(statement.subject, []);
        edges.get(statement.subject).push(statement.object);
      }
      const visiting = new Set();
      const visited = new Set();
      const visit = (node) => {
        if (visiting.has(node)) return true;
        if (visited.has(node)) return false;
        visiting.add(node);
        for (const next of edges.get(node) || []) if (visit(next)) return true;
        visiting.delete(node);
        visited.add(node);
        return false;
      };
      return [...edges.keys()].some(visit);
    };
    for (const predicate of ['lamina:dependsOn', 'lamina:transitionsTo']) {
      if (detectCycle(predicate)) errors.push(`${predicate} relationships must be acyclic.`);
    }

    const workflowOperations = new Map();
    for (const statement of statements.filter((item) => item.predicate === 'lamina:hasStep')) {
      if (!workflowOperations.has(statement.subject)) workflowOperations.set(statement.subject, new Set());
      if (statement.object) workflowOperations.get(statement.subject).add(statement.object);
    }
    const authorizedOperations = new Set(statements
      .filter((item) => item.predicate === 'lamina:authorizedFor' && item.object)
      .map((item) => item.object));
    for (const [workflow, operations] of workflowOperations) {
      for (const operation of operations) {
        if (!authorizedOperations.has(operation)) {
          readiness_gaps.push({
            code: 'actor_authority_missing',
            resource: operation,
            scope: workflow,
            message: `Operation ${operation} has no authorized Actor.`,
          });
        }
      }
    }

    for (const dependency of statements.filter((item) => item.predicate === 'lamina:dependsOn' && item.object)) {
      const target = resourceById.get(dependency.object);
      if (target?.data?.available === false || target?.data?.status === 'unavailable') {
        readiness_gaps.push({
          code: 'dependency_unavailable',
          resource: dependency.object,
          scope: dependency.subject,
          message: `Dependency ${dependency.object} is unavailable.`,
        });
      }
    }

    const directEvidence = new Map();
    for (const statement of statements) {
      directEvidence.set(statement.id, this.query(
        'MATCH (s:Statement {id: $id})-[:SUPPORTED_BY]->(r:Resource) RETURN r.id AS id, r.kind AS kind',
        { id: statement.id },
      ));
    }
    const evidenceKinds = new Set(['evidence', 'observation', 'harness_result']);
    const proofCoverage = new Map();
    for (const statement of statements) {
      const covered = [];
      for (const item of directEvidence.get(statement.id) || []) {
        if (evidenceKinds.has(item.kind)) covered.push(item.id);
      }
      if (statement.predicate === 'lamina:supportedBy' && statement.object &&
          evidenceKinds.has(resourceById.get(statement.object)?.kind)) {
        covered.push(statement.object);
      }
      if (covered.length) {
        if (!proofCoverage.has(statement.subject)) proofCoverage.set(statement.subject, new Set());
        covered.forEach((item) => proofCoverage.get(statement.subject).add(item));
      }
    }
    for (const requirement of statements.filter((item) => item.predicate === 'lamina:requiresProof')) {
      const proof = resourceById.get(requirement.object);
      if (!proof || proof.kind !== 'proof') continue;
      const evidence = new Set([
        ...(proofCoverage.get(proof.id) || []),
        ...(directEvidence.get(requirement.id) || [])
          .filter((item) => evidenceKinds.has(item.kind))
          .map((item) => item.id),
      ]);
      if (!evidence.size) {
        readiness_gaps.push({
          code: 'proof_evidence_missing',
          resource: proof.id,
          scope: requirement.subject,
          message: `Proof ${proof.id} has no reproducible Evidence.`,
        });
      }
    }
    const proofSubjects = new Set(statements
      .filter((item) => item.predicate === 'lamina:requiresProof')
      .map((item) => item.subject));
    for (const resource of resourceRows) {
      if ((resource.data?.proof_required === true ||
          ['critical', 'high'].includes(resource.data?.criticality)) &&
          !proofSubjects.has(resource.id)) {
        readiness_gaps.push({
          code: 'proof_requirement_missing',
          resource: resource.id,
          message: `Critical Resource ${resource.id} has no proof requirement.`,
        });
      }
    }

    const manifests = new Map(resourceRows.filter((item) => item.kind === 'capability_manifest')
      .map((item) => [item.id, item]));
    for (const mission of resourceRows.filter((item) => item.kind === 'mission')) {
      const workflow = resourceById.get(mission.data?.workflow);
      const persona = resourceById.get(mission.data?.persona);
      if (workflow?.kind !== 'workflow' || persona?.kind !== 'persona') {
        errors.push(`Mission ${mission.id} must reference an active Workflow and Persona.`);
      }
      if (mission.data?.adapter) {
        const manifest = manifests.get(mission.data.adapter);
        if (!manifest) {
          errors.push(`Mission ${mission.id} references an inactive capability manifest.`);
        } else {
          const available = new Set(manifest.data?.capabilities || []);
          const missing = (mission.data?.capability_requirements || []).filter((item) => !available.has(item));
          if (missing.length) errors.push(`Mission ${mission.id} lacks capabilities: ${missing.join(', ')}.`);
        }
      }
    }
    for (const run of resourceRows.filter((item) => item.kind === 'run')) {
      if (resourceById.get(run.data?.mission)?.kind !== 'mission' ||
          !run.data?.graph_version || !run.data?.source_revision || !run.data?.session) {
        errors.push(`Run ${run.id} lacks an active Mission or pinned graph/source/session identity.`);
      }
      const harness = statements.find((item) =>
        item.subject === run.id && item.predicate === 'lamina:producedHarnessResult');
      const harnessResource = harness?.object ? resourceById.get(harness.object) : null;
      if (!harnessResource || harnessResource.kind !== 'harness_result') {
        readiness_gaps.push({
          code: 'harness_result_missing',
          resource: run.id,
          message: `Run ${run.id} has no HarnessResult.`,
        });
        continue;
      }
      const eventTypes = new Set((harnessResource.data?.events || []).map((item) => item.type));
      if (!eventTypes.has('oracle_passed')) {
        readiness_gaps.push({
          code: 'oracle_evidence_missing',
          resource: run.id,
          message: `Run ${run.id} has no passing oracle event.`,
        });
      }
      for (const type of ['oracle_failed', 'budget_failure', 'capability_failure']) {
        if (eventTypes.has(type)) {
          readiness_gaps.push({
            code: type,
            resource: run.id,
            message: `Run ${run.id} recorded ${type}.`,
          });
        }
      }
    }
    const contradictions = this.query('MATCH (c:Resource {kind: $kind}) RETURN c.id AS id, c.data AS data', { kind: 'contradiction' })
      .filter((item) => {
        if (!resourceIds.has(item.id)) return false;
        const members = item.data?.members || [];
        return members.length >= 2 && members.every((member) => statementIds.has(member) || resourceIds.has(member));
      });
    return {
      ok: errors.length === 0,
      approved: errors.length === 0 && readiness_gaps.length === 0 &&
        contradictions.length === 0 && stale_evidence.length === 0,
      errors,
      readiness_gaps,
      contradictions: contradictions.map((item) => item.id),
      stale_evidence,
    };
  }

  querySession(id) {
    const session = this.session(id);
    const active = this.activeIds(id);
    return {
      ...session,
      resources: [...active.resources].map((resourceId) => this.resource(resourceId)).filter(Boolean),
      statements: this.statementDetails(active.statements),
      pending_evidence: this.pendingSessionEvidence(id),
      validation: this.validateSet(active.resources, active.statements, session.base_version.source_revision),
    };
  }

  pendingSessionEvidence(id) {
    return this.query(
      `MATCH (v:GraphView {id: $id})-[statementEdge:SESSION_SUPPORT_STMT]->(s:Statement),
             (v)-[evidenceEdge:SESSION_SUPPORT_EVIDENCE]->(r:Resource)
       WHERE statementEdge.key = evidenceEdge.key
       RETURN statementEdge.key AS key, s.id AS statement, r.id AS evidence`,
      { id },
    );
  }

  materializeSessionEvidence(id, activeStatements) {
    for (const pending of this.pendingSessionEvidence(id)) {
      if (!activeStatements.has(pending.statement)) continue;
      const linked = this.query(
        'MATCH (s:Statement {id: $statement})-[:SUPPORTED_BY]->(r:Resource {id: $evidence}) RETURN r.id AS id',
        pending,
      )[0];
      if (!linked) {
        this.query(
          'MATCH (s:Statement {id: $statement}), (r:Resource {id: $evidence}) CREATE (s)-[:SUPPORTED_BY]->(r)',
          pending,
        );
      }
    }
    this.query('MATCH (v:GraphView {id: $id})-[edge:SESSION_SUPPORT_STMT]->() DELETE edge', { id });
    this.query('MATCH (v:GraphView {id: $id})-[edge:SESSION_SUPPORT_EVIDENCE]->() DELETE edge', { id });
  }

  publishSession(id, sourceRevision) {
    const session = this.session(id);
    const branch = this.view(session.base.id);
    const sessionBase = session.base_version;
    const currentHead = this.head(branch.id);
    if (sessionBase.id !== currentHead.id) {
      fail(ERROR.CONFLICT, 'Branch head moved; rebase the session before publishing.', {
        expected: sessionBase.id, actual: currentHead.id,
      });
    }
    return this.transaction(() => {
      const baseActive = this.activeIds(branch.id);
      const desired = this.activeIds(id);
      const active = {
        resources: new Set(baseActive.resources),
        statements: new Set(baseActive.statements),
      };
      const parents = this.graphParents(currentHead, sourceRevision);
      for (const parent of parents) {
        for (const resourceId of parent.receipt?.active_resources || []) active.resources.add(resourceId);
        for (const statementId of parent.receipt?.active_statements || []) active.statements.add(statementId);
      }
      const retiredResources = [...baseActive.resources].filter((item) => !desired.resources.has(item));
      const retiredStatements = [...baseActive.statements].filter((item) => !desired.statements.has(item));
      retiredResources.forEach((item) => active.resources.delete(item));
      retiredStatements.forEach((item) => active.statements.delete(item));
      for (const item of desired.resources) active.resources.add(item);
      for (const item of desired.statements) active.statements.add(item);
      const evidenceLinks = this.pendingSessionEvidence(id).filter((pending) => {
        if (!desired.statements.has(pending.statement)) return false;
        return !this.query(
          'MATCH (s:Statement {id: $statement})-[:SUPPORTED_BY]->(r:Resource {id: $evidence}) RETURN r.id AS id',
          pending,
        )[0];
      });
      this.materializeSessionEvidence(id, active.statements);
      const allStatements = this.statementDetails(active.statements);
      const conflictGroups = new Map();
      for (const statement of allStatements) {
        const key = statementConflictKey(statement);
        if (key === null) continue;
        if (!conflictGroups.has(key)) conflictGroups.set(key, []);
        conflictGroups.get(key).push(statement);
      }
      const existingContradictions = new Map(this.query(
        'MATCH (c:Resource {kind: $kind}) RETURN c.id AS id, c.data AS data',
        { kind: 'contradiction' },
      ).map((item) => [item.id, item]));
      const canonicalContradictions = new Set();
      for (const group of conflictGroups.values()) {
        if (new Set(group.map(statementValueKey)).size < 2) continue;
        const members = group.map((item) => item.id).sort();
        const contradictionId = digest('contradiction', {
          type: 'statement_conflict',
          members,
          data: {},
        });
        if (!existingContradictions.has(contradictionId)) {
          this.createContradiction('statement_conflict', members);
        }
        canonicalContradictions.add(contradictionId);
        active.resources.add(contradictionId);
      }
      const activeStatementContradictions = [...existingContradictions.values()].filter((item) =>
        active.resources.has(item.id) &&
        item.data?.type === 'statement_conflict' &&
        !canonicalContradictions.has(item.id));
      for (const contradiction of activeStatementContradictions) {
        active.resources.delete(contradiction.id);
        if (baseActive.resources.has(contradiction.id) && !retiredResources.includes(contradiction.id)) {
          retiredResources.push(contradiction.id);
        }
      }
      const resources = [...active.resources].filter((item) => !baseActive.resources.has(item));
      const statements = [...active.statements].filter((item) => !baseActive.statements.has(item));
      if (!resources.length && !statements.length && !retiredResources.length && !retiredStatements.length &&
          !evidenceLinks.length &&
          parents.length === 1 &&
          currentHead.source_revision === sourceRevision) {
        this.query('MATCH (s:GraphView {id: $session}) SET s.status = $status', { session: id, status: 'published' });
        return {
          graph_version: currentHead.id,
          source_revision: currentHead.source_revision,
          contradictions: currentHead.receipt?.validation?.contradictions || currentHead.receipt?.contradictions || [],
          validation: currentHead.receipt?.validation || { ok: true, approved: true, errors: [], contradictions: [] },
          idempotent: true,
        };
      }
      const validation = this.validateSet(active.resources, active.statements, sourceRevision);
      if (!validation.ok) fail(ERROR.VALIDATION, 'Session publication failed validation.', validation);
      const versionId = digest('version', {
        parents: parents.map((item) => item.id).sort(),
        sourceRevision,
        resources: [...resources].sort(),
        statements: [...statements].sort(),
        retiredResources: [...retiredResources].sort(),
        retiredStatements: [...retiredStatements].sort(),
        evidenceLinks: evidenceLinks.map(({ statement, evidence }) => ({ statement, evidence }))
          .sort((left, right) => `${left.statement}:${left.evidence}`.localeCompare(`${right.statement}:${right.evidence}`)),
      });
      this.query('CREATE (g:GraphVersion {id: $id, source_revision: $source, receipt: $receipt})', {
        id: versionId,
        source: sourceRevision,
        receipt: graphJson({
          active_resources: [...active.resources].sort(),
          active_statements: [...active.statements].sort(),
          validation,
          contradictions: validation.contradictions,
          evidence_links: evidenceLinks.map(({ statement, evidence }) => ({ statement, evidence })),
        }),
      });
      for (const parent of parents) {
        this.query('MATCH (g:GraphVersion {id: $id}), (p:GraphVersion {id: $parent}) CREATE (g)-[:VERSION_PARENT]->(p)', { id: versionId, parent: parent.id });
      }
      for (const resourceId of resources) this.query('MATCH (g:GraphVersion {id: $version}), (r:Resource {id: $id}) CREATE (g)-[:VERSION_ADD_RES]->(r)', { version: versionId, id: resourceId });
      for (const statementId of statements) this.query('MATCH (g:GraphVersion {id: $version}), (s:Statement {id: $id}) CREATE (g)-[:VERSION_ADD_STMT]->(s)', { version: versionId, id: statementId });
      for (const resourceId of retiredResources) this.query('MATCH (g:GraphVersion {id: $version}), (r:Resource {id: $id}) CREATE (g)-[:VERSION_RETIRE_RES]->(r)', { version: versionId, id: resourceId });
      for (const statementId of retiredStatements) this.query('MATCH (g:GraphVersion {id: $version}), (s:Statement {id: $id}) CREATE (g)-[:VERSION_RETIRE_STMT]->(s)', { version: versionId, id: statementId });
      this.query('MATCH (b:GraphView {id: $branch})-[h:VIEW_HEAD]->() DELETE h', { branch: branch.id });
      this.query('MATCH (b:GraphView {id: $branch}), (g:GraphVersion {id: $version}) CREATE (b)-[:VIEW_HEAD]->(g)', { branch: branch.id, version: versionId });
      this.materializeView(branch.id, {
        active_resources: [...active.resources],
        active_statements: [...active.statements],
      });
      this.query('MATCH (s:GraphView {id: $session}) SET s.status = $status', { session: id, status: 'published' });
      return { graph_version: versionId, source_revision: sourceRevision, contradictions: validation.contradictions, validation };
    });
  }

  rebaseSession(id) {
    const session = this.session(id);
    const current = this.head(session.base.id);
    const previousBase = {
      resources: new Set(session.base_version.receipt?.active_resources || []),
      statements: new Set(session.base_version.receipt?.active_statements || []),
    };
    const desired = this.activeIds(id);
    const retiredResources = new Set([...previousBase.resources].filter((item) => !desired.resources.has(item)));
    const retiredStatements = new Set([...previousBase.statements].filter((item) => !desired.statements.has(item)));
    const addedResources = [...desired.resources].filter((item) => !previousBase.resources.has(item));
    const addedStatements = [...desired.statements].filter((item) => !previousBase.statements.has(item));
    const rebased = {
      active_resources: [
        ...(current.receipt?.active_resources || []).filter((item) => !retiredResources.has(item)),
        ...addedResources,
      ],
      active_statements: [
        ...(current.receipt?.active_statements || []).filter((item) => !retiredStatements.has(item)),
        ...addedStatements,
      ],
    };
    rebased.active_resources = [...new Set(rebased.active_resources)];
    rebased.active_statements = [...new Set(rebased.active_statements)];
    this.transaction(() => {
      this.query('MATCH (s:GraphView {id: $id})-[h:VIEW_HEAD]->() DELETE h', { id });
      this.query('MATCH (s:GraphView {id: $id}), (g:GraphVersion {id: $head}) CREATE (s)-[:VIEW_HEAD]->(g)', { id, head: current.id });
      this.materializeView(id, rebased);
    });
    return this.session(id);
  }

  abortSession(id) {
    const session = this.session(id);
    if (session.status !== 'active') fail(ERROR.CONFLICT, `Session is ${session.status}`);
    this.transaction(() => {
      this.query('MATCH (s:GraphView {id: $id}) SET s.status = $status', { id, status: 'aborted' });
      this.collectSessionOrphans(id);
    });
    return { id, status: 'aborted' };
  }

  collectSessionOrphans(id) {
    this.query('MATCH (v:GraphView {id: $id})-[edge:SESSION_SUPPORT_STMT]->() DELETE edge', { id });
    this.query('MATCH (v:GraphView {id: $id})-[edge:SESSION_SUPPORT_EVIDENCE]->() DELETE edge', { id });
    const statements = this.query(
      'MATCH (v:GraphView {id: $id})-[edge:VIEW_STMT]->(s:Statement) DELETE edge RETURN s.id AS id',
      { id },
    ).map((item) => item.id);
    const resources = this.query(
      'MATCH (v:GraphView {id: $id})-[edge:VIEW_RES]->(r:Resource) DELETE edge RETURN r.id AS id',
      { id },
    ).map((item) => item.id);
    for (const statementId of statements) {
      const refs = this.query(
        `MATCH (s:Statement {id: $id})
         OPTIONAL MATCH (:GraphView)-[viewRef:VIEW_STMT]->(s)
         OPTIONAL MATCH (:GraphVersion)-[versionRef:VERSION_ADD_STMT|VERSION_RETIRE_STMT]->(s)
         RETURN count(DISTINCT viewRef) + count(DISTINCT versionRef) AS refs`,
        { id: statementId },
      )[0];
      if (Number(refs?.refs || 0) === 0) {
        this.query('MATCH (s:Statement {id: $id}) DETACH DELETE s', { id: statementId });
      }
    }
    for (const resourceId of resources) {
      const refs = this.query(
        `MATCH (r:Resource {id: $id})
         OPTIONAL MATCH (:GraphView)-[viewRef:VIEW_RES]->(r)
         OPTIONAL MATCH (:GraphVersion)-[versionRef:VERSION_ADD_RES|VERSION_RETIRE_RES]->(r)
         OPTIONAL MATCH (:Statement)-[statementRef:STMT_SUBJECT|STMT_OBJECT|STMT_SCOPE|SUPPORTED_BY|GENERATED_BY]->(r)
         RETURN count(DISTINCT viewRef) + count(DISTINCT versionRef) + count(DISTINCT statementRef) AS refs`,
        { id: resourceId },
      )[0];
      if (Number(refs?.refs || 0) === 0) {
        this.query('MATCH (a:Alias)-[:ALIAS_TO]->(r:Resource {id: $id}) DETACH DELETE a', { id: resourceId });
        this.query('MATCH (r:Resource {id: $id}) DETACH DELETE r', { id: resourceId });
      }
    }
  }

  resolveView(ref, context) {
    const name = ref === 'HEAD' ? context.branch : ref;
    const view = this.view(name) || this.view(`branch:${name}`);
    if (!view) fail(ERROR.NOT_FOUND, `Graph view not found: ${ref}`);
    return view;
  }

  graphQuery({ at = 'HEAD', subject, predicate, kind, alias }, context) {
    const view = this.resolveView(at, context);
    const active = this.activeIds(view.id);
    let resourceId = subject;
    if (!resourceId && alias) {
      resourceId = this.query('MATCH (a:Alias {key: $alias})-[:ALIAS_TO]->(r:Resource) RETURN r.id AS id', { alias })[0]?.id;
    }
    const resources = [...active.resources].map((id) => this.resource(id)).filter((resource) =>
      resource && (!kind || resource.kind === kind) && (!resourceId || resource.id === resourceId));
    const statements = this.statementDetails(active.statements).filter((statement) =>
      (!resourceId || statement.subject === resourceId || statement.object === resourceId) &&
      (!predicate || statement.predicate === predicate));
    const head = this.head(view.id);
    return {
      graph_version: head,
      resources,
      statements,
      contradictions: this.validateSet(active.resources, active.statements, head?.source_revision).contradictions,
    };
  }

  validateView(ref, scope, context) {
    const view = this.resolveView(ref || 'HEAD', context);
    const active = this.activeIds(view.id);
    const head = this.head(view.id);
    if (!scope) {
      return {
        ...this.validateSet(active.resources, active.statements, head?.source_revision),
        validation_scope: { mode: 'whole_view', view: view.id, resource: null },
      };
    }
    const scopeId = this.resolveResourceId(scope, active.resources);
    if (!scopeId) fail(ERROR.NOT_FOUND, `Validation scope Resource not found: ${scope}`);
    const resources = new Set([scopeId]);
    const statementDetails = this.statementDetails(active.statements);
    const statements = new Set();
    const activeContradictions = [...active.resources]
      .map((id) => this.resource(id))
      .filter((item) => item?.kind === 'contradiction');
    let changed = true;
    while (changed) {
      changed = false;
      for (const statement of statementDetails) {
        if (!resources.has(statement.subject) &&
            !(statement.object && resources.has(statement.object)) &&
            !(statement.scope && resources.has(statement.scope))) continue;
        if (!statements.has(statement.id)) {
          statements.add(statement.id);
          changed = true;
        }
        for (const resource of [statement.subject, statement.object, statement.scope].filter(Boolean)) {
          if (!resources.has(resource)) {
            resources.add(resource);
            changed = true;
          }
        }
      }
      for (const contradiction of activeContradictions) {
        const members = contradiction.data?.members || [];
        if (!resources.has(contradiction.id) &&
            !members.some((member) => statements.has(member) || resources.has(member))) continue;
        if (!resources.has(contradiction.id)) {
          resources.add(contradiction.id);
          changed = true;
        }
        for (const member of members) {
          if (active.statements.has(member) && !statements.has(member)) {
            statements.add(member);
            changed = true;
          } else if (active.resources.has(member) && !resources.has(member)) {
            resources.add(member);
            changed = true;
          }
        }
      }
    }
    return {
      ...this.validateSet(resources, statements, head?.source_revision),
      validation_scope: {
        mode: 'affected_closure',
        view: view.id,
        resource: scopeId,
        resources: resources.size,
        statements: statements.size,
      },
    };
  }

  diff(baseRef, headRef, context) {
    const base = this.resolveView(baseRef, context);
    const head = this.resolveView(headRef, context);
    const a = this.activeIds(base.id);
    const b = this.activeIds(head.id);
    const resourceDiff = {
      added: [...b.resources].filter((id) => !a.resources.has(id)).sort(),
      retired: [...a.resources].filter((id) => !b.resources.has(id)).sort(),
    };
    const statementDiff = {
      added: [...b.statements].filter((id) => !a.statements.has(id)).sort(),
      retired: [...a.statements].filter((id) => !b.statements.has(id)).sort(),
    };
    return {
      base: this.head(base.id).id,
      head: this.head(head.id).id,
      resources: {
        ...resourceDiff,
        added_details: resourceDiff.added.map((id) => this.resource(id)),
        retired_details: resourceDiff.retired.map((id) => this.resource(id)),
      },
      statements: {
        ...statementDiff,
        added_details: this.statementDetails(statementDiff.added),
        retired_details: this.statementDetails(statementDiff.retired),
      },
    };
  }

  status(context) {
    const branch = this.ensureBranch(context.branch, context.source_revision);
    const head = this.head(branch.id);
    return {
      database: this.paths.database,
      branch: context.branch,
      graph_version: head.id,
      source_revision: head.source_revision,
      current_source_revision: context.source_revision,
      stale: head.source_revision !== context.source_revision,
      sessions: this.query('MATCH (s:GraphView {kind: $kind}) RETURN s.id AS id, s.status AS status', { kind: 'session' }),
    };
  }

  missionClosure(viewId, workflowId) {
    const active = this.activeIds(viewId);
    const resources = [...active.resources].map((id) => this.resource(id)).filter(Boolean);
    const resourceById = new Map(resources.map((item) => [item.id, item]));
    const statements = this.statementDetails(active.statements);
    const workflow = resourceById.get(workflowId);
    if (workflow?.kind !== 'workflow') fail(ERROR.NOT_FOUND, `Workflow not found: ${workflowId}`);

    const operations = new Set(statements
      .filter((item) => item.subject === workflowId && item.predicate === 'lamina:hasStep' && item.object)
      .sort((left, right) => (left.qualifiers?.position || 0) - (right.qualifiers?.position || 0))
      .map((item) => item.object));
    const closure = new Set([workflowId, ...operations]);
    const closurePredicates = new Set([
      'lamina:constrainedBy',
      'lamina:dependsOn',
      'lamina:hasScenario',
      'lamina:recovery',
      'lamina:requiresProof',
      'lamina:transitionsTo',
    ]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const statement of statements) {
        if (!statement.object || !closurePredicates.has(statement.predicate)) continue;
        if (closure.has(statement.subject) && !closure.has(statement.object)) {
          closure.add(statement.object);
          changed = true;
        }
      }
    }

    const actors = new Set(statements
      .filter((item) => item.predicate === 'lamina:authorizedFor' &&
        operations.has(item.object) && resourceById.get(item.subject)?.kind === 'actor')
      .map((item) => item.subject));
    const surfaces = new Set(statements
      .filter((item) => item.predicate === 'lamina:realizes' &&
        operations.has(item.object) && resourceById.get(item.subject)?.kind === 'surface')
      .map((item) => item.subject));
    const proofs = new Set(statements
      .filter((item) => item.predicate === 'lamina:requiresProof' &&
        closure.has(item.subject) && resourceById.get(item.object)?.kind === 'proof')
      .map((item) => item.object));
    actors.forEach((item) => closure.add(item));
    surfaces.forEach((item) => closure.add(item));
    proofs.forEach((item) => closure.add(item));

    const explicitRelevant = new Set(statements
      .filter((item) => item.predicate === 'lamina:relevantTo' &&
        closure.has(item.object) && resourceById.get(item.subject)?.kind === 'persona')
      .map((item) => item.subject));
    const assumedActors = new Map();
    for (const statement of statements.filter((item) =>
      item.predicate === 'lamina:canAssume' &&
      resourceById.get(item.subject)?.kind === 'persona' &&
      actors.has(item.object))) {
      if (!assumedActors.has(statement.subject)) assumedActors.set(statement.subject, []);
      assumedActors.get(statement.subject).push(statement.object);
      explicitRelevant.add(statement.subject);
    }
    const allPersonas = resources.filter((item) => item.kind === 'persona').map((item) => item.id);
    const relevantPersonas = explicitRelevant.size ? [...explicitRelevant] : allPersonas;

    const relevantStatements = statements.filter((item) =>
      closure.has(item.subject) || (item.object && closure.has(item.object)));
    const evidence = new Set();
    for (const statement of relevantStatements) {
      if (statement.predicate === 'lamina:supportedBy' &&
          ['evidence', 'observation', 'harness_result'].includes(resourceById.get(statement.object)?.kind)) {
        evidence.add(statement.object);
      }
      for (const item of this.query(
        'MATCH (s:Statement {id: $id})-[:SUPPORTED_BY]->(r:Resource) RETURN r.id AS id',
        { id: statement.id },
      )) evidence.add(item.id);
    }

    const kinds = (ids, kind) => [...ids]
      .filter((id) => resourceById.get(id)?.kind === kind)
      .sort();
    return {
      workflow: workflowId,
      operations: [...operations],
      actors: [...actors].sort(),
      invariants: kinds(closure, 'invariant'),
      scenarios: kinds(closure, 'scenario'),
      surfaces: [...surfaces].sort(),
      proofs: [...proofs].sort(),
      dependencies: [...closure].filter((id) => {
        const kind = resourceById.get(id)?.kind;
        return kind && ![
          'workflow', 'operation', 'actor', 'invariant', 'scenario', 'surface', 'proof',
        ].includes(kind);
      }).sort(),
      evidence: [...evidence].sort(),
      personas: relevantPersonas.sort(),
      assumed_actors: Object.fromEntries([...assumedActors]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, values]) => [key, [...new Set(values)].sort()])),
      statement_ids: relevantStatements.map((item) => item.id).sort(),
    };
  }

  compileMissions({ workflow, persona, adapter = null, session: sessionId = null }, context) {
    const branch = this.ensureBranch(context.branch, context.source_revision);
    let suppliedSession = null;
    if (sessionId) {
      suppliedSession = this.session(sessionId);
      if (suppliedSession.status !== 'active') fail(ERROR.CONFLICT, `Session is ${suppliedSession.status}`);
      if (suppliedSession.base.id !== branch.id) fail(ERROR.BAD_REQUEST, 'Mission session belongs to a different branch.');
    }
    const viewId = suppliedSession?.id || branch.id;
    const active = this.activeIds(viewId);
    const resources = [...active.resources].map((id) => this.resource(id)).filter(Boolean);
    const activeResource = (ref, kind) => {
      const resolved = this.resolveResourceId(ref, active.resources);
      return resources.find((item) =>
        item.kind === kind &&
        (item.id === resolved || item.id === ref || item.data?.alias === ref || item.data?.name === ref));
    };
    const workflowResource = activeResource(workflow, 'workflow');
    if (!workflowResource) fail(ERROR.NOT_FOUND, `Workflow not found: ${workflow}`);
    const workflowClosure = this.missionClosure(viewId, workflowResource.id);
    const personas = persona
      ? [activeResource(persona, 'persona')].filter(Boolean)
      : workflowClosure.personas.map((id) => resources.find((item) => item.id === id)).filter(Boolean);
    if (!personas.length) fail(ERROR.NOT_FOUND, persona ? `Persona not found: ${persona}` : 'No Personas are active.');
    const manifests = resources.filter((item) => item.kind === 'capability_manifest');
    let manifest = null;
    if (adapter) {
      manifest = activeResource(adapter, 'capability_manifest') ||
        manifests.find((item) => item.data?.name === adapter);
      if (!manifest) fail(ERROR.NOT_FOUND, `Capability manifest not found: ${adapter}`);
    }
    const capabilityRequirements = workflowResource.data?.capability_requirements || [];
    if (capabilityRequirements.length && !manifest) {
      fail(ERROR.VALIDATION, `Workflow ${workflowResource.id} requires an adapter capability manifest.`, {
        missing: capabilityRequirements,
      });
    }
    const session = suppliedSession || this.startSession({ branch: context.branch, source_revision: context.source_revision });
    const missions = [];
    try {
      for (const personaResource of personas) {
        const missionData = {
          workflow: workflowResource.id,
          persona: personaResource.id,
          adapter: manifest?.id || null,
          capability_requirements: capabilityRequirements,
          budget: workflowResource.data?.mission_budget || {},
          isolation: 'independent_session',
          closure: {
            operations: workflowClosure.operations,
            actors: workflowClosure.assumed_actors[personaResource.id] || workflowClosure.actors,
            invariants: workflowClosure.invariants,
            scenarios: workflowClosure.scenarios,
            surfaces: workflowClosure.surfaces,
            proofs: workflowClosure.proofs,
            evidence: workflowClosure.evidence,
            dependencies: workflowClosure.dependencies,
            statements: workflowClosure.statement_ids,
          },
        };
        if (manifest) {
          const available = new Set(manifest.data?.capabilities || []);
          const missing = missionData.capability_requirements.filter((item) => !available.has(item));
          if (missing.length) fail(ERROR.VALIDATION, `Adapter ${manifest.id} lacks mission capabilities.`, { missing });
        }
        const id = digest('mission', missionData);
        this.stageResource(session.id, { id, kind: 'mission', data: missionData }, 'intent');
        missions.push({ id, ...missionData });
      }
      if (suppliedSession) {
        const staged = this.activeIds(session.id);
        const validation = this.validateSet(staged.resources, staged.statements, context.source_revision);
        if (!validation.ok) fail(ERROR.VALIDATION, 'Mission compilation failed validation.', validation);
        return {
          graph_version: session.base_version.id,
          source_revision: context.source_revision,
          session: session.id,
          status: 'staged',
          validation,
          missions,
        };
      }
      const published = this.publishSession(session.id, context.source_revision);
      return { ...published, missions };
    } catch (error) {
      if (!suppliedSession) {
        try { this.abortSession(session.id); } catch {}
      }
      throw error;
    }
  }

  runMission({ mission, events = [] }, context) {
    const branch = this.ensureBranch(context.branch, context.source_revision);
    const active = this.activeIds(branch.id);
    if (!active.resources.has(mission)) fail(ERROR.NOT_FOUND, `Mission is not active: ${mission}`);
    const missionResource = this.resource(mission);
    if (missionResource?.kind !== 'mission') fail(ERROR.VALIDATION, `${mission} is not a Mission.`);
    const allowedEvents = new Set([
      'action_attempted', 'state_observed', 'outcome_observed', 'oracle_passed',
      'oracle_failed', 'denial_observed', 'recovery_attempted', 'artifact_captured',
      'budget_failure', 'capability_failure',
    ]);
    for (const event of events) {
      if (!allowedEvents.has(event.type)) fail(ERROR.VALIDATION, `Unknown normalized adapter event: ${event.type}`);
      if (event.epistemic_class !== undefined || event.approved !== undefined) {
        fail(ERROR.SPOOFED_STATUS, 'Adapter events cannot submit epistemic or approval status.');
      }
      if (event.artifact) {
        const artifactPath = path.resolve(event.artifact);
        if (!fs.existsSync(artifactPath)) fail(ERROR.EVIDENCE_MISSING, `Mission artifact does not exist: ${artifactPath}`);
        const content = fs.readFileSync(artifactPath);
        const artifactDigest = digest('artifact', content.toString('base64'));
        const destination = path.join(this.paths.evidence, artifactDigest);
        if (!fs.existsSync(destination)) fs.copyFileSync(artifactPath, destination);
        event.artifact = { digest: artifactDigest, locator: destination };
      }
    }
    const session = this.startSession({ branch: context.branch, source_revision: context.source_revision });
    try {
      const runId = digest('run', { mission, source: context.source_revision, nonce: cryptoRandom() });
      const harnessId = digest('harness', { run: runId, events });
      this.stageResource(session.id, {
        id: runId,
        kind: 'run',
        data: { mission, graph_version: this.head(branch.id).id, source_revision: context.source_revision, session: session.id },
      }, 'runtime');
      this.stageResource(session.id, {
        id: harnessId,
        kind: 'harness_result',
        data: { mission, run: runId, events },
      }, 'runtime');
      this.stageStatement(session.id, {
        subject: runId,
        predicate: 'lamina:producedHarnessResult',
        object: harnessId,
        evidence: [harnessId],
      }, 'runtime');
      const validation = this.validateSet(
        this.activeIds(session.id).resources,
        this.activeIds(session.id).statements,
        context.source_revision,
      );
      if (!validation.ok) fail(ERROR.VALIDATION, 'Mission Run failed validation.', validation);
      return {
        graph_version: this.head(branch.id).id,
        source_revision: context.source_revision,
        run: runId,
        harness_result: harnessId,
        session: session.id,
        status: 'staged',
        validation,
      };
    } catch (error) {
      try { this.abortSession(session.id); } catch {}
      throw error;
    }
  }

  applyObservationBatch({ snapshot, upserts = [], deletes = [], generation }) {
    if (!snapshot?.product || !snapshot?.source_revision || !generation) fail(ERROR.BAD_REQUEST, 'Observation batch lacks snapshot or generation.');
    if (!Array.isArray(upserts) || !Array.isArray(deletes)) fail(ERROR.BAD_REQUEST, 'Observation upserts and deletes must be arrays.');
    const currentGeneration = fs.readFileSync(path.join(this.paths.cocoindex, 'target-generation'), 'utf8').trim();
    if (generation !== currentGeneration) {
      if (upserts.length) fail(ERROR.CONFLICT, 'Observation target generation is stale.', {
        expected: currentGeneration,
        actual: generation,
      });
      return { view: `observation:${snapshot.product}:${generation}`, upserted: 0, deleted: 0, committed: true, stale_generation: true };
    }
    const viewId = `observation:${snapshot.product}:${generation}`;
    return this.transaction(() => {
      this.retireObservationViews(snapshot.product, viewId);
      if (!this.view(viewId)) this.query('CREATE (v:GraphView {id: $id, kind: $kind, name: $name, status: $status})', { id: viewId, kind: 'observation', name: viewId, status: 'active' });
      else this.query('MATCH (v:GraphView {id: $id}) SET v.status = $status', { id: viewId, status: 'active' });
      for (const envelope of upserts) {
        if (JSON.stringify(canonical(envelope.source_snapshot)) !== JSON.stringify(canonical(snapshot))) {
          fail(ERROR.VALIDATION, 'Observation envelope snapshot does not match its batch snapshot.');
        }
        if (!envelope.source_key || !envelope.content_hash || !envelope.extractor?.id ||
            !envelope.extractor?.version || envelope.payload === undefined) {
          fail(ERROR.VALIDATION, 'Observation envelope is incomplete.');
        }
        const expected = digest('observation', {
          snapshot: envelope.source_snapshot,
          source_key: envelope.source_key,
          content_hash: envelope.content_hash,
          extractor: envelope.extractor,
          payload: envelope.payload,
        });
        if (envelope.id && envelope.id !== expected) fail(ERROR.VALIDATION, `Non-deterministic observation id: ${envelope.id}`);
        const result = this.createResource({
          id: expected,
          kind: 'observation',
          data: { ...envelope, id: expected },
        }, 'observation');
        // Source snapshots intentionally change whenever the working tree changes.
        // Keep exactly one active observation per source key/extractor in this view;
        // historical evidence resources remain intact when referenced elsewhere.
        const superseded = this.query(
          'MATCH (v:GraphView {id: $view})-[:VIEW_RES]->(r:Resource {kind: $kind}) RETURN r.id AS id, r.data AS data',
          { view: viewId, kind: 'observation' },
        ).filter((item) => item.id !== result.id &&
          item.data?.source_key === envelope.source_key &&
          item.data?.extractor?.id === envelope.extractor.id &&
          item.data?.extractor?.version === envelope.extractor.version);
        for (const item of superseded) {
          this.query(
            'MATCH (v:GraphView {id: $view})-[edge:VIEW_RES]->(r:Resource {id: $id}) DELETE edge',
            { view: viewId, id: item.id },
          );
        }
        for (const item of superseded) {
          const retained = this.query(
            `MATCH (r:Resource {id: $id})
             OPTIONAL MATCH (:GraphView)-[viewRef:VIEW_RES]->(r)
             OPTIONAL MATCH (:Statement)-[evidenceRef:SUPPORTED_BY]->(r)
             RETURN count(viewRef) + count(evidenceRef) AS refs`,
            { id: item.id },
          )[0];
          if (retained && Number(retained.refs) === 0) {
            this.query('MATCH (r:Resource {id: $id}) DETACH DELETE r', { id: item.id });
          }
        }
        const linked = this.query('MATCH (v:GraphView {id: $view})-[:VIEW_RES]->(r:Resource {id: $id}) RETURN r.id AS id', { view: viewId, id: result.id })[0];
        if (!linked) this.query('MATCH (v:GraphView {id: $view}), (r:Resource {id: $id}) CREATE (v)-[:VIEW_RES]->(r)', { view: viewId, id: result.id });
      }
      for (const id of deletes) {
        this.query('MATCH (v:GraphView {id: $view})-[edge:VIEW_RES]->(r:Resource {id: $id}) DELETE edge', { view: viewId, id });
        const retained = this.query(
          `MATCH (r:Resource {id: $id})
           OPTIONAL MATCH (:GraphView)-[viewRef:VIEW_RES]->(r)
           OPTIONAL MATCH (:Statement)-[evidenceRef:SUPPORTED_BY]->(r)
           RETURN count(viewRef) + count(evidenceRef) AS refs`,
          { id },
        )[0];
        if (retained && Number(retained.refs) === 0) {
          this.query('MATCH (r:Resource {id: $id}) DETACH DELETE r', { id });
        }
      }
      return { view: viewId, upserted: upserts.length, deleted: deletes.length, committed: true };
    });
  }

  observationStatus({ product, generation }) {
    const viewId = `observation:${product}:${generation}`;
    const view = this.view(viewId);
    if (!view) return {
      exists: false,
      view: viewId,
      generation,
      count: 0,
      source_key_count: 0,
      source_revisions: [],
      resource_ids: [],
    };
    const observations = this.query(
      'MATCH (v:GraphView {id: $id})-[:VIEW_RES]->(r:Resource {kind: $kind}) RETURN r.id AS id, r.data AS data',
      { id: viewId, kind: 'observation' },
    );
    const categoryCounts = {};
    const unsupported = {};
    for (const observation of observations) {
      for (const category of observation.data?.payload?.brownfield?.categories || []) {
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
      }
      for (const reason of observation.data?.payload?.brownfield?.unsupported || []) {
        unsupported[reason] = (unsupported[reason] || 0) + 1;
      }
    }
    return {
      exists: true,
      view: viewId,
      generation,
      count: observations.length,
      source_key_count: new Set(observations.map((item) => item.data?.source_key).filter(Boolean)).size,
      resource_ids: observations.map((item) => item.id).sort(),
      source_revisions: [...new Set(observations.map((item) => item.data?.source_snapshot?.source_revision).filter(Boolean))].sort(),
      source_roots: [...new Set(observations.map((item) => item.data?.source_snapshot?.source_root).filter(Boolean))].sort(),
      extractors: [...new Set(observations.map((item) => {
        const extractor = item.data?.extractor;
        return extractor?.id && extractor?.version ? `${extractor.id}@${extractor.version}` : null;
      }).filter(Boolean))].sort(),
      coverage: canonical(categoryCounts),
      unsupported: canonical(unsupported),
      limitations: [
        'Static source observations do not prove runtime reachability or behavior.',
        'Dynamic dispatch, generated code, remote services, and runtime-only configuration require Mission evidence.',
        'Absence of an Observation is not evidence that behavior does not exist.',
      ],
    };
  }

  invalidateObservations(product) {
    if (!product) fail(ERROR.BAD_REQUEST, 'Observation invalidation requires a Product reference.');
    const generation = digest('generation', {
      previous: fs.readFileSync(path.join(this.paths.cocoindex, 'target-generation'), 'utf8').trim(),
      nonce: cryptoRandom(),
    });
    fs.writeFileSync(path.join(this.paths.cocoindex, 'target-generation'), `${generation}\n`);
    this.transaction(() => {
      this.retireObservationViews(product);
    });
    return { invalidated: true, generation, next_update_reemits_all: true };
  }

  retireObservationViews(product, exceptView = null) {
    const views = this.query(
      'MATCH (v:GraphView {kind: $kind}) RETURN v.id AS id, v.name AS name',
      { kind: 'observation' },
    ).filter((view) => view.id !== exceptView && view.name?.startsWith(`observation:${product}:`));
    for (const view of views) {
      const observations = this.query(
        'MATCH (v:GraphView {id: $id})-[edge:VIEW_RES]->(r:Resource {kind: $kind}) DELETE edge RETURN r.id AS id',
        { id: view.id, kind: 'observation' },
      ).map((item) => item.id);
      this.query('MATCH (v:GraphView {id: $id}) SET v.status = $status', { id: view.id, status: 'invalidated' });
      for (const id of observations) {
        const retained = this.query(
          `MATCH (r:Resource {id: $id})
           OPTIONAL MATCH (:GraphView {status: $active})-[viewRef:VIEW_RES]->(r)
           OPTIONAL MATCH (:Statement)-[evidenceRef:SUPPORTED_BY]->(r)
           RETURN count(DISTINCT viewRef) + count(DISTINCT evidenceRef) AS refs`,
          { id, active: 'active' },
        )[0];
        if (Number(retained?.refs || 0) === 0) {
          this.query('MATCH (r:Resource {id: $id}) DETACH DELETE r', { id });
        }
      }
    }
  }

  backup(output) {
    const statements = this.statementDetails(
      this.query('MATCH (s:Statement) RETURN s.id AS id').map((item) => item.id).sort(),
    ).sort((left, right) => left.id.localeCompare(right.id));
    for (const statement of statements) {
      statement.evidence = this.query('MATCH (s:Statement {id: $id})-[:SUPPORTED_BY]->(r:Resource) RETURN r.id AS id', { id: statement.id }).map((item) => item.id).sort();
      statement.generated_by = this.query('MATCH (s:Statement {id: $id})-[:GENERATED_BY]->(r:Resource) RETURN r.id AS id', { id: statement.id }).map((item) => item.id).sort();
    }
    const versions = this.query('MATCH (g:GraphVersion) RETURN g.id AS id, g.source_revision AS source_revision, g.receipt AS receipt')
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const version of versions) {
      version.parents = this.query('MATCH (g:GraphVersion {id: $id})-[:VERSION_PARENT]->(p:GraphVersion) RETURN p.id AS id', { id: version.id }).map((item) => item.id).sort();
      version.add_resources = this.query('MATCH (g:GraphVersion {id: $id})-[:VERSION_ADD_RES]->(r:Resource) RETURN r.id AS id', { id: version.id }).map((item) => item.id).sort();
      version.add_statements = this.query('MATCH (g:GraphVersion {id: $id})-[:VERSION_ADD_STMT]->(s:Statement) RETURN s.id AS id', { id: version.id }).map((item) => item.id).sort();
      version.retire_resources = this.query('MATCH (g:GraphVersion {id: $id})-[:VERSION_RETIRE_RES]->(r:Resource) RETURN r.id AS id', { id: version.id }).map((item) => item.id).sort();
      version.retire_statements = this.query('MATCH (g:GraphVersion {id: $id})-[:VERSION_RETIRE_STMT]->(s:Statement) RETURN s.id AS id', { id: version.id }).map((item) => item.id).sort();
    }
    const views = this.query('MATCH (v:GraphView) RETURN v.id AS id, v.kind AS kind, v.name AS name, v.status AS status')
      .sort((left, right) => left.id.localeCompare(right.id));
    for (const view of views) {
      view.head = this.head(view.id)?.id || null;
      view.base = this.query('MATCH (v:GraphView {id: $id})-[:VIEW_BASE]->(b:GraphView) RETURN b.id AS id', { id: view.id })[0]?.id || null;
      view.resources = this.query('MATCH (v:GraphView {id: $id})-[:VIEW_RES]->(r:Resource) RETURN r.id AS id', { id: view.id }).map((item) => item.id).sort();
      view.statements = this.query('MATCH (v:GraphView {id: $id})-[:VIEW_STMT]->(s:Statement) RETURN s.id AS id', { id: view.id }).map((item) => item.id).sort();
      view.pending_evidence = view.kind === 'session'
        ? this.pendingSessionEvidence(view.id).sort((left, right) => left.key.localeCompare(right.key))
        : [];
    }
    const body = {
      format: 'lamina-graph-backup-v1',
      resources: this.query('MATCH (r:Resource) RETURN r.id AS id, r.kind AS kind, r.data AS data')
        .sort((left, right) => left.id.localeCompare(right.id)),
      aliases: this.query('MATCH (a:Alias)-[:ALIAS_TO]->(r:Resource) RETURN a.key AS key, r.id AS resource')
        .sort((left, right) => left.key.localeCompare(right.key)),
      statements,
      versions,
      views,
    };
    const integrity = digest('backup', body);
    const payload = { ...body, integrity };
    fs.writeFileSync(output, `${JSON.stringify(canonical(payload), null, 2)}\n`, { flag: 'wx' });
    return { output: path.resolve(output), digest: integrity };
  }

  restore(input) {
    const payload = JSON.parse(fs.readFileSync(input, 'utf8'));
    if (payload.format !== 'lamina-graph-backup-v1') fail(ERROR.VALIDATION, 'Unsupported graph backup format.');
    if (payload.integrity) {
      const { integrity, ...body } = payload;
      const actual = digest('backup', body);
      if (integrity !== actual) fail(ERROR.VALIDATION, 'Graph backup integrity check failed.', {
        expected: integrity,
        actual,
      });
    }
    const existing = this.query(
      'MATCH (r:Resource) RETURN count(r) AS resources',
    )[0]?.resources || 0;
    const versions = this.query('MATCH (g:GraphVersion) RETURN count(g) AS versions')[0]?.versions || 0;
    const views = this.query('MATCH (v:GraphView) RETURN count(v) AS views')[0]?.views || 0;
    if (Number(existing) || Number(versions) || Number(views)) {
      fail(ERROR.CONFLICT, 'Restore requires an empty graph database.');
    }
    return this.transaction(() => {
      for (const resource of payload.resources || []) {
        this.query('CREATE (r:Resource {id: $id, kind: $kind, data: $data})', {
          id: resource.id, kind: resource.kind, data: graphJson(resource.data),
        });
      }
      for (const alias of payload.aliases || []) {
        this.query('CREATE (a:Alias {key: $key})', { key: alias.key });
        this.query('MATCH (a:Alias {key: $key}), (r:Resource {id: $resource}) CREATE (a)-[:ALIAS_TO]->(r)', alias);
      }
      for (const statement of payload.statements || []) {
        this.query('CREATE (s:Statement {id: $id, predicate: $predicate, literal: $literal, qualifiers: $qualifiers})', {
          id: statement.id, predicate: statement.predicate, literal: graphJson(statement.literal), qualifiers: graphJson(statement.qualifiers),
        });
        this.query('MATCH (s:Statement {id: $id}), (r:Resource {id: $subject}) CREATE (s)-[:STMT_SUBJECT]->(r)', { id: statement.id, subject: statement.subject });
        if (statement.object) this.query('MATCH (s:Statement {id: $id}), (r:Resource {id: $object}) CREATE (s)-[:STMT_OBJECT]->(r)', { id: statement.id, object: statement.object });
        if (statement.scope) this.query('MATCH (s:Statement {id: $id}), (r:Resource {id: $scope}) CREATE (s)-[:STMT_SCOPE]->(r)', { id: statement.id, scope: statement.scope });
        for (const evidence of statement.evidence || []) this.query('MATCH (s:Statement {id: $id}), (r:Resource {id: $resource}) CREATE (s)-[:SUPPORTED_BY]->(r)', { id: statement.id, resource: evidence });
        for (const generator of statement.generated_by || []) this.query('MATCH (s:Statement {id: $id}), (r:Resource {id: $resource}) CREATE (s)-[:GENERATED_BY]->(r)', { id: statement.id, resource: generator });
      }
      for (const version of payload.versions || []) {
        this.query('CREATE (g:GraphVersion {id: $id, source_revision: $source_revision, receipt: $receipt})', {
          id: version.id, source_revision: version.source_revision, receipt: graphJson(version.receipt),
        });
      }
      for (const version of payload.versions || []) {
        for (const parent of version.parents || []) this.query('MATCH (g:GraphVersion {id: $id}), (p:GraphVersion {id: $parent}) CREATE (g)-[:VERSION_PARENT]->(p)', { id: version.id, parent });
        for (const resource of version.add_resources || []) this.query('MATCH (g:GraphVersion {id: $id}), (r:Resource {id: $resource}) CREATE (g)-[:VERSION_ADD_RES]->(r)', { id: version.id, resource });
        for (const statement of version.add_statements || []) this.query('MATCH (g:GraphVersion {id: $id}), (s:Statement {id: $statement}) CREATE (g)-[:VERSION_ADD_STMT]->(s)', { id: version.id, statement });
        for (const resource of version.retire_resources || []) this.query('MATCH (g:GraphVersion {id: $id}), (r:Resource {id: $resource}) CREATE (g)-[:VERSION_RETIRE_RES]->(r)', { id: version.id, resource });
        for (const statement of version.retire_statements || []) this.query('MATCH (g:GraphVersion {id: $id}), (s:Statement {id: $statement}) CREATE (g)-[:VERSION_RETIRE_STMT]->(s)', { id: version.id, statement });
      }
      for (const view of payload.views || []) {
        this.query('CREATE (v:GraphView {id: $id, kind: $kind, name: $name, status: $status})', view);
      }
      for (const view of payload.views || []) {
        if (view.head) this.query('MATCH (v:GraphView {id: $id}), (g:GraphVersion {id: $head}) CREATE (v)-[:VIEW_HEAD]->(g)', { id: view.id, head: view.head });
        if (view.base) this.query('MATCH (v:GraphView {id: $id}), (b:GraphView {id: $base}) CREATE (v)-[:VIEW_BASE]->(b)', { id: view.id, base: view.base });
        for (const resource of view.resources || []) {
          this.query('MATCH (v:GraphView {id: $id}), (r:Resource {id: $resource}) CREATE (v)-[:VIEW_RES]->(r)', { id: view.id, resource });
        }
        for (const statement of view.statements || []) {
          this.query('MATCH (v:GraphView {id: $id}), (s:Statement {id: $statement}) CREATE (v)-[:VIEW_STMT]->(s)', { id: view.id, statement });
        }
        for (const pending of view.pending_evidence || []) {
          this.query(
            'MATCH (v:GraphView {id: $id}), (s:Statement {id: $statement}) CREATE (v)-[:SESSION_SUPPORT_STMT {key: $key}]->(s)',
            { id: view.id, statement: pending.statement, key: pending.key },
          );
          this.query(
            'MATCH (v:GraphView {id: $id}), (r:Resource {id: $evidence}) CREATE (v)-[:SESSION_SUPPORT_EVIDENCE {key: $key}]->(r)',
            { id: view.id, evidence: pending.evidence, key: pending.key },
          );
        }
      }
      return {
        restored: true,
        resources: payload.resources?.length || 0,
        statements: payload.statements?.length || 0,
        versions: payload.versions?.length || 0,
        views: payload.views?.length || 0,
      };
    });
  }
}

function cryptoRandom() {
  return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
