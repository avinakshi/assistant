import { createClient } from '@/lib/supabase/server';
import { PersonaForm } from './persona-form';
import { PersonaRow } from './persona-row';

export const dynamic = 'force-dynamic';

interface PersonaListItem {
  id: string;
  name: string;
  system_prompt: string;
  is_default: boolean;
  created_at: string;
}

export default async function PersonasPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('personas')
    .select('id, name, system_prompt, is_default, created_at')
    .order('created_at', { ascending: false });

  const personas: PersonaListItem[] = (data as PersonaListItem[] | null) ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Personas</h1>
      <p className="mt-1 text-sm text-ink-500">
        A persona is a custom system prompt appended to the default behavioral / coding /
        system-design packs. Useful for niche interviews — SRE with heavy incident focus,
        staff ML with MLOps bent, staff frontend with A11y emphasis. Pro tier only in prod.
      </p>

      <div className="mt-6 rounded-xl border border-ink-100 bg-white p-6 shadow-sm">
        <PersonaForm />
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500">
          Your personas
        </h2>
        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Failed to load: {error.message}
          </div>
        )}
        {personas.length === 0 ? (
          <div className="mt-3 rounded-lg border border-dashed border-ink-100 bg-white p-6 text-sm text-ink-500">
            No personas yet. Most users never need one — the built-in packs handle 90% of
            interviews.
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-ink-100 overflow-hidden rounded-xl border border-ink-100 bg-white">
            {personas.map((p) => (
              <PersonaRow
                key={p.id}
                id={p.id}
                name={p.name}
                systemPrompt={p.system_prompt}
                isDefault={p.is_default}
                createdAt={p.created_at}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
