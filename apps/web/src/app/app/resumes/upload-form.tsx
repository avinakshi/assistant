'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { uploadResumeAction } from './actions';
import { cn } from '@/lib/cn';

export function UploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    const fd = new FormData();
    fd.set('file', file);
    fd.set('name', name || file.name);
    const result = await uploadResumeAction(fd);
    setUploading(false);
    if (!result.ok) {
      setError(result.error ?? 'upload failed');
      return;
    }
    setFile(null);
    setName('');
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-ink-700">
        Resume file (PDF / DOCX / TXT)
        <input
          type="file"
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="rounded-md border border-ink-100 bg-white px-3 py-2 text-sm"
          required
          disabled={uploading}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink-700">
        Display name (optional)
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={file?.name ?? 'My senior SWE resume'}
          className="rounded-md border border-ink-100 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500"
          disabled={uploading}
        />
      </label>
      <button
        type="submit"
        disabled={!file || uploading}
        className={cn(
          'self-start rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition',
          'hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {uploading ? 'Uploading + parsing…' : 'Upload'}
      </button>
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <p className="text-xs text-ink-500">
        Parsing takes 2–5 s. We run the text through Gemini to extract companies, titles, and
        skills — that context is what makes the LLM&apos;s answers specific to your background.
      </p>
    </form>
  );
}
