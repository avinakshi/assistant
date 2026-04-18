import { describe, it, expect } from 'vitest';
import { stripHtml, extractTitle } from './jd';

describe('stripHtml', () => {
  it('removes script and style blocks wholesale', () => {
    const html = `
      <html><head>
        <script>alert(1)</script>
        <style>body{color:red}</style>
      </head><body><p>Real content</p></body></html>`;
    const out = stripHtml(html);
    expect(out).not.toContain('alert(1)');
    expect(out).not.toContain('color:red');
    expect(out).toContain('Real content');
  });

  it('drops html comments', () => {
    const out = stripHtml('<p>one<!-- hidden note --> two</p>');
    expect(out).toBe('one two');
  });

  it('decodes the common entities', () => {
    const out = stripHtml('<p>Tom&nbsp;&amp;&nbsp;Jerry &lt;3 &quot;good&quot; &#39;stuff&#39;</p>');
    expect(out).toContain('Tom & Jerry <3 "good" \'stuff\'');
  });

  it('collapses whitespace but preserves line breaks', () => {
    const html = '<p>line one</p>\n<p>line  two</p>\n\n<p>line three</p>';
    const out = stripHtml(html);
    expect(out.split('\n')).toEqual(['line one', 'line two', 'line three']);
  });

  it('returns empty string for an all-tag document', () => {
    expect(stripHtml('<html><body><div></div></body></html>')).toBe('');
  });
});

describe('extractTitle', () => {
  it('parses the "<Role> at <Company> | Board" LinkedIn pattern', () => {
    const html = '<title>Senior SRE at Razorpay | LinkedIn</title>';
    expect(extractTitle(html)).toEqual({
      title: 'Senior SRE at Razorpay | LinkedIn',
      role: 'Senior SRE',
      company: 'Razorpay',
    });
  });

  it('handles en-dash and em-dash separators', () => {
    expect(extractTitle('<title>Staff Engineer \u2014 Stripe</title>').company).toBe('Stripe');
    expect(extractTitle('<title>Platform Engineer \u2013 Vercel</title>').company).toBe('Vercel');
  });

  it('falls back to og:site_name when the title has no role pattern', () => {
    const html = `
      <title>Careers</title>
      <meta property="og:site_name" content="Linear" />`;
    expect(extractTitle(html)).toEqual({ title: 'Careers', company: 'Linear' });
  });

  it('returns an empty object when nothing parseable is present', () => {
    expect(extractTitle('<html><body></body></html>')).toEqual({});
  });

  it('prefers <title> over og:title when both are present for role extraction', () => {
    const html = `
      <title>Backend Engineer at Acme | Greenhouse</title>
      <meta property="og:title" content="Join us" />`;
    const out = extractTitle(html);
    expect(out.role).toBe('Backend Engineer');
    expect(out.company).toBe('Acme');
  });
});
