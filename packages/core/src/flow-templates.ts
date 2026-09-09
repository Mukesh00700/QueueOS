/**
 * Flow templates — starting points for a branch's stage sequence.
 *
 * Independent of `VerticalId`: a vertical picks words and colours, a template
 * picks the stage shape. See queue-flow-design.md §7 and §4 for the worked
 * examples these are drawn from. Fully editable after provisioning — a
 * template is a starting point, not a lock-in.
 */

import type { StageType } from './enums';

export interface FlowTemplateStage {
  /** Local key used only to wire `nextKey` within this template. */
  key: string;
  name: string;
  stageType: StageType;
  tokenPrefix: string;
  /** Defaults to true; PAYMENT stages are explicitly false — a checkout step, not a line. */
  hasVisibleQueue?: boolean;
  /** Key of the stage that follows. Omit on a flow's last stage(s). */
  nextKey?: string;
}

export interface FlowTemplate {
  id: string;
  label: string;
  description: string;
  stages: FlowTemplateStage[];
}

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    id: 'single',
    label: 'Single queue',
    description: "One line, start to finish — today's default. Right for a clinic, salon, or simple counter.",
    stages: [{ key: 'main', name: 'Main Queue', stageType: 'DEPARTMENT', tokenPrefix: 'A' }],
  },
  {
    id: 'qsr',
    label: 'Quick-service restaurant',
    description: 'Order at the counter, pay, then wait for your food to come up.',
    stages: [
      { key: 'order', name: 'Ordering', stageType: 'ORDERING', tokenPrefix: 'O', nextKey: 'pay' },
      { key: 'pay', name: 'Payment', stageType: 'PAYMENT', tokenPrefix: 'PAY', hasVisibleQueue: false, nextKey: 'pickup' },
      { key: 'pickup', name: 'Pickup', stageType: 'PREPARATION', tokenPrefix: 'PU' },
    ],
  },
  {
    id: 'token-style',
    label: 'Token counter (Udupi-style)',
    description: 'Order and pay in one step at the counter, then wait for pickup.',
    stages: [
      { key: 'order', name: 'Order & Pay', stageType: 'ORDERING', tokenPrefix: 'ORD', nextKey: 'pickup' },
      { key: 'pickup', name: 'Pickup', stageType: 'PREPARATION', tokenPrefix: 'PU' },
    ],
  },
  {
    id: 'casual-dining',
    label: 'Casual dining',
    description: 'Wait for a table, get served, pay at the end.',
    stages: [
      { key: 'wait', name: 'Waitlist', stageType: 'ENTRY', tokenPrefix: 'W', nextKey: 'table' },
      { key: 'table', name: 'Table / Service', stageType: 'SERVICE', tokenPrefix: 'T', nextKey: 'pay' },
      { key: 'pay', name: 'Payment', stageType: 'PAYMENT', tokenPrefix: 'PAY', hasVisibleQueue: false },
    ],
  },
  {
    id: 'apparel-retail',
    label: 'Apparel retail (Zudio-style)',
    description: 'Browse freely, wait for a trial room, then pay.',
    stages: [
      { key: 'trial', name: 'Trial Room', stageType: 'TRIAL', tokenPrefix: 'TR', nextKey: 'pay' },
      { key: 'pay', name: 'Payment', stageType: 'PAYMENT', tokenPrefix: 'PAY', hasVisibleQueue: false },
    ],
  },
  {
    id: 'big-box-retail',
    label: 'Big-box / department store',
    description: 'Independent department counters that all lead to one checkout.',
    stages: [
      { key: 'dept1', name: 'Electronics', stageType: 'DEPARTMENT', tokenPrefix: 'ELE', nextKey: 'pay' },
      { key: 'dept2', name: 'Customer Service', stageType: 'DEPARTMENT', tokenPrefix: 'CS', nextKey: 'pay' },
      { key: 'pay', name: 'Payment', stageType: 'PAYMENT', tokenPrefix: 'PAY', hasVisibleQueue: false },
    ],
  },
];

export function getFlowTemplate(id: string): FlowTemplate {
  return FLOW_TEMPLATES.find((t) => t.id === id) ?? FLOW_TEMPLATES[0];
}
