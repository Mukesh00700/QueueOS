import type { Prisma } from '@prisma/client';
import { getFlowTemplate } from '@queueos/core';

/**
 * Creates every queue in a flow template and wires the `nextQueueId` chain
 * between them, in one pass. Runs inside the caller's transaction so a
 * branch never ends up with half a flow if something fails partway.
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
  }

  for (const stage of template.stages) {
    if (!stage.nextKey) continue;
    const queueId = ids.get(stage.key);
    const nextQueueId = ids.get(stage.nextKey);
    if (!queueId || !nextQueueId) continue;
    await tx.queue.update({ where: { id: queueId }, data: { nextQueueId } });
  }
}
