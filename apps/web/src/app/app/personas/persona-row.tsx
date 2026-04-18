'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deletePersonaAction, setDefaultPersonaAction } from './actions';

interface Props {
  id: string;
  name: string;
  systemPrompt: string;
  isDefault: boolean;
  createdAt: string;
}

export function PersonaRow({ id, name, systemPrompt, isDefault, createdAt }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const setDefault = () => {
    startTransition(() => {
      void setDefaultPersonaAction(id).then((r) => {
        if (r.ok) router.refresh();
      });
    });
  };
  const del = () => {
    if (!window.confirm(`Delete persona "${name}"?`)) return;
    startTransition(() => {
      void deletePersonaAction(id).then((r) => {
        if (r.ok) router.refresh();
      });
    });
  };

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-ink-900">{name}</span>
            {isDefault && (
              <span className="rounded bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                default
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-ink-500">
            Created {new Date(createdAt).toLocaleDateString()}
          </div>
          <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs text-ink-500">
            {systemPrompt}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {!isDefault && (
            <button
              type="button"
              onClick={setDefault}
              disabled={pending}
              className="rounded border border-ink-100 px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-50 disabled:opacity-50"
            >
              Set default
            </button>
          )}
          <button
            type="button"
            onClick={del}
            disabled={pending}
            className="rounded border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}
