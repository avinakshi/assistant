/**
 * Shared empty-page component for the dashboard sub-routes. Each sub-route is scaffolded
 * now so navigation + route-integrity tests pass; the real UIs land in subsequent 6.x
 * phases (6b resumes/JDs/personas CRUD, 6c billing, 6f settings, etc.).
 */
export function Placeholder({
  title,
  phase,
  note,
}: {
  title: string;
  phase: string;
  note: string;
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-ink-500">
        <span className="mr-2 rounded bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-700">
          {phase}
        </span>
        {note}
      </p>
    </div>
  );
}
