const definitions = [
  {
    graph: 'commerce',
    workflows: [
      ['checkout', 'buy', 'complete a purchase with an authorized payment', 'shopper', 'a confirmed order is charged once', 'payment authorization expires', 'checkout page', 'submitOrder'],
      ['refunds', 'return', 'return a captured payment to the original method', 'support agent', 'refund total never exceeds captured value', 'processor rejects a duplicate refund', 'refund console', 'issueRefund'],
      ['catalog', 'merchandise', 'publish searchable product information', 'merchandiser', 'only published products appear to shoppers', 'media processing fails', 'catalog editor', 'publishProduct'],
      ['inventory', 'stock', 'reserve and release sellable units safely', 'warehouse operator', 'available stock never becomes negative', 'two reservations race', 'inventory panel', 'reserveStock'],
      ['account', 'membership', 'manage shopper identity and saved preferences', 'registered shopper', 'private account data stays scoped to its owner', 'email change needs reverification', 'account settings', 'updateAccount'],
    ],
  },
  {
    graph: 'medication-adherence',
    workflows: [
      ['dose-reminders', 'remind', 'schedule medication adherence reminders without medical advice', 'elder', 'a dose is never recorded from reminder delivery alone', 'reminder delivery is interrupted', 'daily schedule', 'sendDoseReminder'],
      ['refill-inventory', 'refills', 'track remaining medicine supply and refill thresholds', 'guardian', 'inventory cannot fall below zero', 'a duplicate dose event arrives', 'supply dashboard', 'recordInventoryUse'],
      ['elder-consent', 'consent', 'capture and withdraw elder permission before automated calls', 'elder', 'withdrawal fences every queued call', 'consent changes while a call is queued', 'consent review', 'withdrawConsent'],
      ['guardian-calls', 'calling', 'place consented adherence calls for due reminders', 'guardian', 'no call starts without current elder consent', 'the call provider is unavailable', 'call activity', 'placeReminderCall'],
      ['adherence-reports', 'reports', 'summarize recorded adherence events without clinical interpretation', 'guardian', 'reports distinguish unknown from missed', 'events arrive out of order', 'history report', 'buildAdherenceReport'],
    ],
  },
  {
    graph: 'collaboration',
    workflows: [
      ['projects', 'workspace', 'create and archive shared project workspaces', 'project owner', 'archived projects reject new work', 'archive races with an edit', 'project overview', 'archiveProject'],
      ['permissions', 'access', 'grant least-privilege project roles', 'administrator', 'a user has no capability outside active grants', 'a role is revoked during a request', 'member access panel', 'changeMemberRole'],
      ['comments', 'discussion', 'post and resolve threaded review comments', 'reviewer', 'resolved threads preserve history', 'two reviewers resolve simultaneously', 'review thread', 'resolveComment'],
      ['notifications', 'alerts', 'deliver relevant collaboration notifications', 'member', 'muted events never produce delivery', 'a provider retries the same event', 'notification preferences', 'deliverNotification'],
      ['audit-history', 'audit', 'inspect immutable records of privileged changes', 'auditor', 'audit events cannot be edited or deleted', 'event persistence is interrupted', 'audit timeline', 'appendAuditEvent'],
    ],
  },
  {
    graph: 'travel',
    workflows: [
      ['booking', 'reserve', 'confirm a stay for available dates and guests', 'traveler', 'one inventory unit cannot back two confirmed stays', 'availability changes during payment', 'booking flow', 'confirmBooking'],
      ['cancellation', 'cancel', 'cancel an eligible stay and expose its outcome', 'traveler', 'cancellation is idempotent', 'supplier confirmation times out', 'reservation details', 'cancelBooking'],
      ['itinerary', 'trip-plan', 'organize confirmed travel items into a trip view', 'traveler', 'an itinerary never invents an unconfirmed item', 'a supplier update arrives late', 'trip timeline', 'refreshItinerary'],
      ['guest-messaging', 'messages', 'exchange scoped messages with a property host', 'guest', 'only booking participants can read the thread', 'a message is delivered twice', 'booking inbox', 'sendGuestMessage'],
      ['payment-reconciliation', 'settlement', 'reconcile supplier charges and captured payments', 'finance operator', 'each capture maps to one reconciliation record', 'supplier and processor totals disagree', 'reconciliation console', 'reconcilePayment'],
    ],
  },
];

const paraphrases = new Map([
  ['workflow.commerce.checkout', 'let a shopper pay and receive an order confirmation'],
  ['workflow.commerce.refunds', 'send money back after a completed charge'],
  ['workflow.commerce.catalog', 'make item listings visible in search'],
  ['workflow.commerce.inventory', 'hold units during an order and restore abandoned quantities'],
  ['workflow.commerce.account', 'change a customer identity details and preferences'],
  ['workflow.medication-adherence.dose-reminders', 'prompt an older adult when scheduled medicine is due'],
  ['workflow.medication-adherence.refill-inventory', 'warn a caregiver before pills run out'],
  ['workflow.medication-adherence.elder-consent', 'let an older adult revoke permission for phone outreach'],
  ['workflow.medication-adherence.guardian-calls', 'telephone a person about a due dose only after permission'],
  ['workflow.medication-adherence.adherence-reports', 'show a caregiver what was taken skipped or unreported'],
  ['workflow.collaboration.projects', 'open or close a shared team workspace'],
  ['workflow.collaboration.permissions', 'limit each teammate to the access their role permits'],
  ['workflow.collaboration.comments', 'close a conversation thread while keeping its record'],
  ['workflow.collaboration.notifications', 'tell teammates about relevant activity unless muted'],
  ['workflow.collaboration.audit-history', 'review a tamper resistant trail of administrative actions'],
  ['workflow.travel.booking', 'secure lodging for chosen nights and party size'],
  ['workflow.travel.cancellation', 'release an eligible reservation without repeating the action'],
  ['workflow.travel.itinerary', 'collect confirmed journey items into one trip view'],
  ['workflow.travel.guest-messaging', 'let a visitor and host talk inside their reservation'],
  ['workflow.travel.payment-reconciliation', 'match property charges against money already captured'],
]);

export function retrievalFixture() {
  const graphs = definitions.map((definition) => ({
    id: definition.graph,
    workflows: definition.workflows.map((row) => {
      const [name, alias, objective, persona, invariant, failure, surface, operation] = row;
      const id = `workflow.${definition.graph}.${name}`;
      return {
        id,
        alias,
        objective,
        persona,
        invariant,
        failure,
        surface,
        operation,
        text: [
          `workflow: ${id}`,
          `aliases: ${alias}`,
          `objective: ${objective}`,
          `persona: ${persona}`,
          `invariant: ${invariant}`,
          `failure: ${failure}`,
          `surface: ${surface}`,
          `operation: ${operation}`,
        ].join('\n'),
        source_documents: [
          {
            file: `src/${definition.graph}/${name}.ts`,
            symbol: operation,
            text: `export async function ${operation}() {\n  // ${objective}\n  // failure: ${failure}\n}`,
          },
          {
            file: `tests/${definition.graph}/${name}.test.ts`,
            symbol: `${operation}Contract`,
            text: `test('${invariant}', async () => verify${operation}Contract())`,
          },
          {
            file: `docs/${definition.graph}/${name}.md`,
            symbol: '<module>',
            text: `# ${surface}\n\nUsed by the ${persona}.`,
          },
        ],
      };
    }),
  }));

  const workflowQueries = [];
  const sourceQueries = [];
  let sequence = 0;
  const addWorkflow = (query) => {
    workflowQueries.push({ ...query, split: sequence++ % 3 === 0 ? 'development' : 'held_out' });
  };
  for (const graph of graphs) {
    for (const workflow of graph.workflows) {
      for (const [kind, query] of [
        ['exact_id', workflow.id],
        ['exact_alias', workflow.alias],
        ['paraphrase', paraphrases.get(workflow.id)],
        ['persona', `What can the ${workflow.persona} accomplish here?`],
        ['invariant', workflow.invariant],
        ['failure_state', `Recover when ${workflow.failure}`],
        ['surface', `Change the ${workflow.surface}`],
        ['operation', `Implement ${workflow.operation}`],
      ]) {
        addWorkflow({
          graph: graph.id,
          kind,
          query,
          expected: [workflow.id],
        });
      }
      for (const [kind, query] of [
        ['operation', `Where is ${workflow.operation} implemented?`],
        ['objective', workflow.objective],
        ['failure_state', `Handle this failure: ${workflow.failure}`],
        ['symbol', workflow.operation.replace(/([a-z])([A-Z])/g, '$1 $2')],
        ['invariant', `Enforce ${workflow.invariant}`],
        ['surface', `Code behind the ${workflow.surface}`],
      ]) {
        sourceQueries.push({
          graph: graph.id,
          workflow: workflow.id,
          kind,
          query,
          expected_file: workflow.source_documents[0].file,
          split: sourceQueries.length % 3 === 0 ? 'development' : 'held_out',
        });
      }
    }
    for (let index = 0; index < graph.workflows.length; index += 1) {
      for (const offset of [1, 2]) {
        const left = graph.workflows[index];
        const right = graph.workflows[(index + offset) % graph.workflows.length];
        addWorkflow({
          graph: graph.id,
          kind: 'multi_workflow',
          query: `${left.operation} and ${right.operation}`,
          expected: [left.id, right.id],
        });
      }
    }
    const newRequests = [
      'forecast solar panel output',
      'moderate a live video stream',
      'calculate employee payroll taxes',
      'train an image classification model',
      'control greenhouse irrigation valves',
      'transcribe a courtroom recording',
      'grade a university examination',
      'dispatch an emergency fire crew',
      'compose a film soundtrack',
      'simulate orbital spacecraft docking',
    ];
    for (const query of newRequests) {
      addWorkflow({
        graph: graph.id,
        kind: 'new_workflow',
        query,
        expected: [],
      });
    }
  }
  if (workflowQueries.length !== 240 || sourceQueries.length !== 120 || graphs.length !== 4) {
    throw new Error('Retrieval fixture cardinality changed unexpectedly.');
  }
  return { graphs, workflowQueries, sourceQueries };
}
