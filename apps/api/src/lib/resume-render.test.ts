import { describe, it, expect } from 'vitest';
import { renderStructuredResume } from './resume-render';

describe('renderStructuredResume', () => {
  it('returns null for empty / invalid inputs', () => {
    expect(renderStructuredResume(null)).toBeNull();
    expect(renderStructuredResume(undefined)).toBeNull();
    expect(renderStructuredResume('not-an-object')).toBeNull();
    expect(renderStructuredResume({})).toBeNull();
  });

  it('renders the happy-path resume with all sections', () => {
    const out = renderStructuredResume({
      name: 'Jane Doe',
      headline: 'Senior Backend Engineer',
      yearsOfExperience: 7,
      summary: 'Infra engineer with a decade of payments work.',
      skills: ['Go', 'Rust', 'Postgres'],
      experience: [
        {
          title: 'Staff Engineer',
          company: 'Acme',
          dates: '2023-now',
          bullets: ['Led migration to service mesh', 'Drove on-call down 40%'],
        },
      ],
      projects: [
        {
          name: 'Ledger-X',
          description: 'Open-source double-entry ledger.',
          tech: ['Go', 'Postgres'],
        },
      ],
      education: ['BS CS, IIT Bombay'],
      certifications: ['AWS Solutions Architect'],
    });
    expect(out).not.toBeNull();
    const s = out as string;
    expect(s).toContain('Name: Jane Doe');
    expect(s).toContain('Headline: Senior Backend Engineer');
    expect(s).toContain('Years of experience: 7');
    expect(s).toContain('Summary:');
    expect(s).toContain('Skills: Go, Rust, Postgres');
    expect(s).toContain('Experience:');
    expect(s).toContain('Staff Engineer \u2014 Acme \u2014 2023-now');
    expect(s).toContain('\u2022 Led migration to service mesh');
    expect(s).toContain('Projects:');
    expect(s).toContain('Ledger-X');
    expect(s).toContain('Tech: Go, Postgres');
    expect(s).toContain('Education:');
    expect(s).toContain('- BS CS, IIT Bombay');
    expect(s).toContain('Certifications:');
    expect(s).toContain('- AWS Solutions Architect');
  });

  it('drops non-string entries inside arrays', () => {
    const out = renderStructuredResume({
      skills: ['Go', 42, null, 'Rust', ''],
    });
    expect(out).toContain('Skills: Go, Rust');
    expect(out).not.toContain('42');
  });

  it('returns null when every recognizable field is empty', () => {
    expect(renderStructuredResume({ unknown: 'x', extra: [1, 2, 3] })).toBeNull();
  });

  it('handles partial experience entries without emitting empty headers', () => {
    const out = renderStructuredResume({
      experience: [{ bullets: ['solo bullet'] }, { company: 'Only Co' }],
    });
    const s = out as string;
    expect(s).toContain('\u2022 solo bullet');
    expect(s).toContain('Only Co');
  });
});
