'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteJdAction } from './actions';

interface Props {
  id: string;
  company: string | null;
  role: string | null;
  sourceUrl: string | null;
  excerpt: string;
  createdAt: string;
}

export function JdRow({ id, company, role, sourceUrl, excerpt, createdAt }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const del = () => {
    if (!window.confirm(`Delete this JD?`)) return;
    startTransition(() => {
      void deleteJdAction(id).then((r) => {
        if (r.ok) router.refresh();
      });
    });
  };

  const title = [role, company].filter(Boolean).join(' · ') || 'Untitled JD';

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate font-medium text-ink-900">{title}</div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-500">
            <span>Saved {new Date(createdAt).toLocaleDateString()}</span>
            {sourceUrl && (
              <>
                <span>·</span>
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-600 hover:underline"
                >
                  source
                </a>
              </>
            )}
          </div>
          {excerpt && (
            <p className="mt-2 line-clamp-3 text-xs text-ink-500" title={excerpt}>
              {excerpt}…
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={del}
          disabled={pending}
          className="shrink-0 rounded border border-red-200 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </li>
  );
}
