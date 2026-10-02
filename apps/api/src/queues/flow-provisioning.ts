import type { Prisma } from '@prisma/client';
import { getFlowTemplate } from '@queueos/core';

/**
 * Creates every queue in a flow template, one counter per queue, and wires
 * the `nextQueueId` chain between them, in one pass. Runs inside the
 * caller's transaction so a branch never ends up with half a flow if
 * something fails partway.
 *
 * The counter is named after its queue — simplest, least-surprising
 * default, no new naming convention to invent. Without this, a freshly
 * registered (or newly added) branch has queues but nothing to actually
 * serve anyone with, despite the registration page's own copy promising
 * "one branch already set up" — found live, testing a fresh business
 * end to end.
 */
export async function provisionFlow(tx: Prisma.TransactionClient, branchId: string, templateId: string) {
  const template = getFlowTemplate(templateId);
  const ids = new Map<string, string>();

  for (const [index, stage] of template.stages.entries()) {
    const queue = await tx.queue.create({
      data: {
        branchId,
        name: stage.name,
        tokenPrefix: stage.tokenPrefix,
        stageType: stage.stageType,
        hasVisibleQueue: stage.hasVisibleQueue ?? true,
        displayOrder: index,
      },
    });
    ids.set(stage.key, queue.id);
    await tx.counter.create({ data: { branchId, queueId: queue.id, name: stage.name } });
  }

  for (const stage of template.stages) {
    if (!stage.nextKey) continue;
    const queueId = ids.get(stage.key);
    const nextQueueId = ids.get(stage.nextKey);
    if (!queueId || !nextQueueId) continue;
    await tx.queue.update({ where: { id: queueId }, data: { nextQueueId } });
  }
}
