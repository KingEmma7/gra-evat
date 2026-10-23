'use client';
import { ManualState } from '../components/manual-state';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ManualState
      heading="The manual could not load"
      message="Try loading this page again. Browser mock data is held in memory and may be cleared."
      retry={reset}
    />
  );
}
