'use client';

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Link from 'next/link';

type WorkflowViewProps = {
  backHref?: string;
  backLabel?: string;
};

export default function WorkflowView({
  backHref = '/map',
  backLabel = 'Map',
}: WorkflowViewProps) {
  const [content, setContent] = useState<string>('');
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/workflow');
      if (!res.ok) throw new Error('Failed to load');
      const { content: text } = await res.json();
      setContent(text ?? '');
      setEditValue(text ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load workflow');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/workflow', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editValue }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setContent(editValue);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-950 text-stone-200 flex items-center justify-center">
        <p className="text-stone-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-950 text-stone-200">
      <header className="sticky top-0 z-10 border-b border-stone-700/60 bg-stone-950/90 backdrop-blur supports-[backdrop-filter]:bg-stone-950/70">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between gap-4">
          <Link
            href={backHref}
            className="text-stone-500 hover:text-stone-300 text-sm transition-colors"
          >
            ← {backLabel}
          </Link>
          <div className="flex items-center gap-2">
            {error && (
              <span className="text-amber-400/90 text-sm">{error}</span>
            )}
            {editing ? (
              <>
                <button
                  onClick={() => {
                    setEditValue(content);
                    setEditing(false);
                  }}
                  className="px-3 py-1.5 text-sm rounded border border-stone-600 text-stone-400 hover:bg-stone-800/80 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="px-3 py-1.5 text-sm rounded bg-amber-600 hover:bg-amber-500 text-stone-950 font-medium disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="px-3 py-1.5 text-sm rounded border border-stone-600 text-stone-300 hover:bg-stone-800/80 transition-colors"
              >
                Edit
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {editing ? (
          <textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="w-full min-h-[70vh] p-4 rounded-lg bg-stone-900 border border-stone-700 text-stone-200 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 resize-y"
            placeholder="Workflow markdown…"
            spellCheck="false"
          />
        ) : (
          <article className="workflow-doc [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:mb-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:pb-1 [&_h2]:border-b [&_h2]:border-stone-700 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_p]:text-stone-300 [&_p]:my-2 [&_ul]:my-3 [&_ul]:pl-6 [&_li]:my-0.5 [&_table]:w-full [&_table]:text-sm [&_th]:text-left [&_th]:py-2 [&_th]:pr-4 [&_th]:border-b [&_th]:border-stone-700 [&_td]:py-2 [&_td]:pr-4 [&_td]:border-b [&_td]:border-stone-700/60 [&_a]:text-amber-400 [&_a]:underline [&_a:hover]:text-amber-300 [&_hr]:border-stone-700 [&_hr]:my-6 [&_em]:italic [&_strong]:font-semibold">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </article>
        )}
      </main>
    </div>
  );
}
