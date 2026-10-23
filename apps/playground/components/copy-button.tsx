'use client';
import { useState } from 'react';
import { Icon } from './icon';

export function CopyButton({ value, label = 'Copy JSON' }: { value: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
      setTimeout(() => setState('idle'), 2400);
    } catch {
      setState('failed');
    }
  }
  return (
    <span className="copy-control">
      <button
        type="button"
        className="button button-small button-quiet"
        onClick={() => void copy()}
      >
        <Icon name={state === 'copied' ? 'check' : 'copy'} size={14} />
        {state === 'copied' ? 'Copied' : label}
      </button>
      <span className="sr-only" role="status">
        {state === 'failed'
          ? 'Clipboard unavailable. Select and copy the code below.'
          : state === 'copied'
            ? `${label} copied to clipboard.`
            : ''}
      </span>
    </span>
  );
}
