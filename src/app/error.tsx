"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-6">
      <h1 className="text-lg font-semibold">Something went wrong loading this page</h1>
      <p className="mt-2 text-sm text-ink-2">
        Your data has not been changed. If this is a new deployment, check that <code>DATABASE_URL</code> is set and that{" "}
        <a className="link" href="/api/health">/api/health</a> reports the database as OK.
      </p>
      {error.digest && <p className="mt-2 text-xs text-muted">Reference: {error.digest}</p>}
      <button className="btn btn-primary mt-4" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
