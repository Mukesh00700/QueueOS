'use client';

import { FLOW_TEMPLATES } from '@queueos/core';
import { cn } from '@/lib/utils';

/**
 * The "flow" half of the two independent setup choices from
 * queue-flow-design.md §7 — vertical picks words, this picks stage shape.
 * Each card previews the resulting chain so the choice is legible before
 * committing; every template stays fully editable afterward from Queues.
 */
export function FlowTemplatePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {FLOW_TEMPLATES.map((template) => {
        const selected = template.id === value;
        return (
          <button
            key={template.id}
            type="button"
            onClick={() => onChange(template.id)}
            aria-pressed={selected}
            className={cn(
              'rounded-xl border p-3 text-left transition-colors',
              selected ? 'border-accent bg-accent/5' : 'border-line bg-raised hover:border-line-strong',
            )}
          >
            <p className="text-sm font-medium">{template.label}</p>
            <p className="mt-0.5 text-xs text-muted">{template.description}</p>
            <p className="mt-2 text-[11px] font-medium text-subtle">
              {template.stages.map((stage) => stage.name).join(' → ')}
            </p>
          </button>
        );
      })}
    </div>
  );
}
