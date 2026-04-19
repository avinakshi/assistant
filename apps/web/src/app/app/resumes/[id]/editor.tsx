'use client';

import { useState, useTransition } from 'react';
import { saveStructuredResumeAction } from '../actions';

interface Experience {
  company: string;
  title: string;
  dates: string;
  bullets: string[];
}

interface Project {
  name: string;
  description: string;
  tech: string[];
}

interface Structured {
  name: string;
  headline: string;
  summary: string;
  yearsOfExperience: string; // keep as string for the input; coerce on save
  skills: string[];
  education: string[];
  certifications: string[];
  experience: Experience[];
  projects: Project[];
}

const EMPTY: Structured = {
  name: '',
  headline: '',
  summary: '',
  yearsOfExperience: '',
  skills: [],
  education: [],
  certifications: [],
  experience: [],
  projects: [],
};

function hydrate(raw: Record<string, unknown> | null): Structured {
  if (!raw) return EMPTY;
  const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');
  const asStrArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const asNumStr = (v: unknown): string =>
    typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  const asExperience = (v: unknown): Experience[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
          .map((x) => ({
            company: asStr(x['company']),
            title: asStr(x['title']),
            dates: asStr(x['dates']),
            bullets: asStrArr(x['bullets']),
          }))
      : [];
  const asProjects = (v: unknown): Project[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
          .map((x) => ({
            name: asStr(x['name']),
            description: asStr(x['description']),
            tech: asStrArr(x['tech']),
          }))
      : [];
  return {
    name: asStr(raw['name']),
    headline: asStr(raw['headline']),
    summary: asStr(raw['summary']),
    yearsOfExperience: asNumStr(raw['yearsOfExperience']),
    skills: asStrArr(raw['skills']),
    education: asStrArr(raw['education']),
    certifications: asStrArr(raw['certifications']),
    experience: asExperience(raw['experience']),
    projects: asProjects(raw['projects']),
  };
}

function serialize(s: Structured): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (s.name.trim()) out['name'] = s.name.trim();
  if (s.headline.trim()) out['headline'] = s.headline.trim();
  if (s.summary.trim()) out['summary'] = s.summary.trim();
  const yoe = Number.parseFloat(s.yearsOfExperience);
  if (Number.isFinite(yoe) && yoe > 0) out['yearsOfExperience'] = yoe;
  const skills = s.skills.map((x) => x.trim()).filter(Boolean);
  if (skills.length > 0) out['skills'] = skills;
  const education = s.education.map((x) => x.trim()).filter(Boolean);
  if (education.length > 0) out['education'] = education;
  const certs = s.certifications.map((x) => x.trim()).filter(Boolean);
  if (certs.length > 0) out['certifications'] = certs;
  const experience = s.experience
    .map((e) => ({
      company: e.company.trim(),
      title: e.title.trim(),
      dates: e.dates.trim(),
      bullets: e.bullets.map((b) => b.trim()).filter(Boolean),
    }))
    .filter((e) => e.company || e.title || e.dates || e.bullets.length > 0);
  if (experience.length > 0) out['experience'] = experience;
  const projects = s.projects
    .map((p) => ({
      name: p.name.trim(),
      description: p.description.trim(),
      tech: p.tech.map((t) => t.trim()).filter(Boolean),
    }))
    .filter((p) => p.name || p.description || p.tech.length > 0);
  if (projects.length > 0) out['projects'] = projects;
  return out;
}

export function StructuredResumeEditor({
  resumeId,
  initial,
  rawText,
}: {
  readonly resumeId: string;
  readonly initial: Record<string, unknown> | null;
  readonly rawText: string;
}) {
  const [state, setState] = useState<Structured>(() => hydrate(initial));
  const [showRaw, setShowRaw] = useState(false);
  const [status, setStatus] = useState<
    { kind: 'idle' } | { kind: 'ok'; at: number } | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(() => {
      void (async () => {
        const payload = serialize(state);
        const res = await saveStructuredResumeAction(resumeId, payload);
        if (res.ok) setStatus({ kind: 'ok', at: Date.now() });
        else setStatus({ kind: 'error', message: res.error ?? 'save failed' });
      })();
    });
  };

  const chips = (
    items: string[],
    setItems: (next: string[]) => void,
    placeholder: string,
  ) => (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((x, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-800"
          >
            <input
              value={x}
              onChange={(e) => {
                const next = items.slice();
                next[i] = e.target.value;
                setItems(next);
              }}
              className="border-none bg-transparent p-0 text-xs outline-none focus:ring-0"
              style={{ width: `${Math.max(6, x.length + 1)}ch` }}
            />
            <button
              type="button"
              onClick={() => setItems(items.filter((_, j) => j !== i))}
              aria-label={`Remove ${x}`}
              className="text-brand-600 hover:text-brand-800"
            >
              ×
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => setItems([...items, ''])}
          className="rounded-full border border-dashed border-ink-200 px-2.5 py-1 text-xs text-ink-500 hover:border-brand-400 hover:text-brand-700"
        >
          + {placeholder}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-ink-100 bg-white p-5">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">Basics</div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="Full name" value={state.name} onChange={(v) => setState({ ...state, name: v })} />
          <Field
            label="Years of experience"
            value={state.yearsOfExperience}
            onChange={(v) => setState({ ...state, yearsOfExperience: v })}
            placeholder="e.g. 6"
          />
          <Field
            label="Headline"
            value={state.headline}
            onChange={(v) => setState({ ...state, headline: v })}
            placeholder="e.g. Senior Backend Engineer — payments & infra"
            wide
          />
        </div>
        <div className="mt-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            Summary
          </label>
          <textarea
            value={state.summary}
            onChange={(e) => setState({ ...state, summary: e.target.value })}
            rows={3}
            placeholder="2-3 sentence about blurb."
            className="mt-1 block w-full resize-none rounded-md border border-ink-100 bg-white px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
      </section>

      <section className="rounded-xl border border-ink-100 bg-white p-5">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">Skills</div>
        <div className="mt-3">
          {chips(state.skills, (next) => setState({ ...state, skills: next }), 'add skill')}
        </div>
      </section>

      <section className="rounded-xl border border-ink-100 bg-white p-5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">Experience</div>
          <button
            type="button"
            onClick={() =>
              setState({
                ...state,
                experience: [...state.experience, { company: '', title: '', dates: '', bullets: [] }],
              })
            }
            className="text-xs text-brand-700 hover:underline"
          >
            + Add role
          </button>
        </div>
        <div className="mt-3 space-y-4">
          {state.experience.length === 0 && (
            <div className="text-xs text-ink-500">No roles yet.</div>
          )}
          {state.experience.map((exp, i) => (
            <div key={i} className="rounded-md border border-ink-100 bg-ink-50 p-3">
              <div className="grid gap-2 md:grid-cols-3">
                <Field
                  label="Title"
                  value={exp.title}
                  onChange={(v) => {
                    const next = state.experience.slice();
                    next[i] = { ...exp, title: v };
                    setState({ ...state, experience: next });
                  }}
                />
                <Field
                  label="Company"
                  value={exp.company}
                  onChange={(v) => {
                    const next = state.experience.slice();
                    next[i] = { ...exp, company: v };
                    setState({ ...state, experience: next });
                  }}
                />
                <Field
                  label="Dates"
                  value={exp.dates}
                  onChange={(v) => {
                    const next = state.experience.slice();
                    next[i] = { ...exp, dates: v };
                    setState({ ...state, experience: next });
                  }}
                  placeholder="Jan 2023 — Present"
                />
              </div>
              <div className="mt-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                  Bullets
                </div>
                <ul className="mt-2 space-y-2">
                  {exp.bullets.map((b, j) => (
                    <li key={j} className="flex items-start gap-2">
                      <span className="mt-2 text-ink-400">•</span>
                      <textarea
                        value={b}
                        onChange={(e) => {
                          const nextBullets = exp.bullets.slice();
                          nextBullets[j] = e.target.value;
                          const next = state.experience.slice();
                          next[i] = { ...exp, bullets: nextBullets };
                          setState({ ...state, experience: next });
                        }}
                        rows={2}
                        className="flex-1 resize-none rounded-md border border-ink-100 bg-white px-3 py-1.5 text-sm text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const nextBullets = exp.bullets.filter((_, k) => k !== j);
                          const next = state.experience.slice();
                          next[i] = { ...exp, bullets: nextBullets };
                          setState({ ...state, experience: next });
                        }}
                        className="mt-1 text-xs text-ink-400 hover:text-red-600"
                        aria-label="Remove bullet"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => {
                    const next = state.experience.slice();
                    next[i] = { ...exp, bullets: [...exp.bullets, ''] };
                    setState({ ...state, experience: next });
                  }}
                  className="mt-2 text-xs text-brand-700 hover:underline"
                >
                  + Add bullet
                </button>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() =>
                    setState({
                      ...state,
                      experience: state.experience.filter((_, k) => k !== i),
                    })
                  }
                  className="text-xs text-red-700 hover:underline"
                >
                  Remove role
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-ink-100 bg-white p-5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">Projects</div>
          <button
            type="button"
            onClick={() =>
              setState({
                ...state,
                projects: [...state.projects, { name: '', description: '', tech: [] }],
              })
            }
            className="text-xs text-brand-700 hover:underline"
          >
            + Add project
          </button>
        </div>
        <div className="mt-3 space-y-4">
          {state.projects.length === 0 && (
            <div className="text-xs text-ink-500">No projects yet.</div>
          )}
          {state.projects.map((p, i) => (
            <div key={i} className="rounded-md border border-ink-100 bg-ink-50 p-3">
              <Field
                label="Name"
                value={p.name}
                onChange={(v) => {
                  const next = state.projects.slice();
                  next[i] = { ...p, name: v };
                  setState({ ...state, projects: next });
                }}
              />
              <div className="mt-3">
                <label className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                  Description
                </label>
                <textarea
                  value={p.description}
                  onChange={(e) => {
                    const next = state.projects.slice();
                    next[i] = { ...p, description: e.target.value };
                    setState({ ...state, projects: next });
                  }}
                  rows={2}
                  className="mt-1 block w-full resize-none rounded-md border border-ink-100 bg-white px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
              <div className="mt-3">
                <label className="text-xs font-semibold uppercase tracking-wider text-ink-500">
                  Tech
                </label>
                <div className="mt-2">
                  {chips(
                    p.tech,
                    (nextTech) => {
                      const next = state.projects.slice();
                      next[i] = { ...p, tech: nextTech };
                      setState({ ...state, projects: next });
                    },
                    'add tech',
                  )}
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() =>
                    setState({ ...state, projects: state.projects.filter((_, k) => k !== i) })
                  }
                  className="text-xs text-red-700 hover:underline"
                >
                  Remove project
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-ink-100 bg-white p-5">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          Education
        </div>
        <div className="mt-3">
          {chips(
            state.education,
            (next) => setState({ ...state, education: next }),
            'add education row',
          )}
        </div>
      </section>

      <section className="rounded-xl border border-ink-100 bg-white p-5">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          Certifications
        </div>
        <div className="mt-3">
          {chips(
            state.certifications,
            (next) => setState({ ...state, certifications: next }),
            'add cert',
          )}
        </div>
      </section>

      {rawText && (
        <section className="rounded-xl border border-ink-100 bg-white p-5">
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="text-xs font-medium text-ink-500 hover:text-ink-900"
          >
            {showRaw ? 'Hide' : 'Show'} raw uploaded text
          </button>
          {showRaw && (
            <pre className="mt-3 max-h-[280px] overflow-auto whitespace-pre-wrap rounded-md bg-ink-50 p-3 text-[11px] text-ink-700">
              {rawText}
            </pre>
          )}
        </section>
      )}

      <div className="sticky bottom-4 flex items-center justify-between rounded-xl border border-ink-100 bg-white p-3 shadow-md">
        <div className="text-xs text-ink-500">
          {status.kind === 'ok' && 'Saved ✓'}
          {status.kind === 'error' && <span className="text-red-700">{status.message}</span>}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded bg-brand-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  wide,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly placeholder?: string;
  readonly wide?: boolean;
}) {
  return (
    <label className={`block text-xs font-semibold uppercase tracking-wider text-ink-500 ${wide ? 'md:col-span-2' : ''}`}>
      {label}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 block w-full rounded-md border border-ink-100 bg-white px-3 py-1.5 text-sm font-normal normal-case text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
      />
    </label>
  );
}
