'use client';

export function ManualState({
  heading,
  message,
  busy = false,
  retry,
}: {
  heading: string;
  message: string;
  busy?: boolean;
  retry?: () => void;
}) {
  return (
    <>
      <a className="skip-link" href="#page-state">
        Skip to content
      </a>
      <aside className="manual-nav">
        <a className="wordmark" href="/">
          gra-evat
        </a>
        <p className="muted">Developer manual</p>
        <nav aria-label="Main navigation">
          <a href="/#quickstart">Quickstart</a>
          <a href="/#builder">Invoice builder</a>
          <a href="/#receipt">Receipt and refunds</a>
          <a href="/#api-reference">API reference</a>
          <a href="/#integration">SDK integration</a>
        </nav>
      </aside>
      <main className="manual-main" aria-busy={busy}>
        <div className="manual-content">
          <section className="manual-section" id="page-state" aria-labelledby="page-state-title">
            <h1 id="page-state-title">{heading}</h1>
            <p role={busy ? 'status' : undefined}>{message}</p>
            <div className="button-row">
              {retry && (
                <button className="button" type="button" onClick={retry}>
                  Try again
                </button>
              )}
              <a href="/">Return to quickstart</a>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
