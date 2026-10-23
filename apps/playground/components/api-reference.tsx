import { API_REFERENCE } from '../lib/api-reference';
import { CopyButton } from './copy-button';

export function ApiReference() {
  return (
    <section id="api-reference" className="manual-section" aria-labelledby="api-reference-title">
      <div className="section-heading">
        <h2 id="api-reference-title">API reference</h2>
        <p className="muted">
          JSON operations from{' '}
          <a href="https://documenter.getpostman.com/view/29809098/2sBXVeGCzK">
            GRA E-VAT Postman v8.2
          </a>
          . Send the <code>security_key</code> header with every request. These examples use{' '}
          <code>mock</code> for the local mock and synthetic identifiers. Replace credentials and
          the taxpayer path when connecting to GRA.
        </p>
      </div>
      {API_REFERENCE.map((endpoint, index) => (
        <details className="endpoint" key={endpoint.id} open={index === 0}>
          <summary className="endpoint-heading">
            <h3 id={`api-${endpoint.id}`}>{endpoint.title}</h3>
            <code>
              {endpoint.method} {endpoint.path}
            </code>
          </summary>
          <p>{endpoint.description}</p>
          <div className="request-response">
            <div className="code-block">
              <div className="code-header">
                <h4>{endpoint.requestLabel}</h4>
                <CopyButton value={endpoint.request} label="Copy request" />
              </div>
              <pre tabIndex={0} aria-label={`${endpoint.title} request`}>
                <code>{endpoint.request}</code>
              </pre>
            </div>
            <div className="code-block">
              <div className="code-header">
                <h4>{endpoint.responseLabel}</h4>
                <CopyButton value={endpoint.response} label="Copy response" />
              </div>
              <pre tabIndex={0} aria-label={`${endpoint.title} response`}>
                <code>{endpoint.response}</code>
              </pre>
              <p className="code-caption muted">{endpoint.responseNote}</p>
            </div>
          </div>
        </details>
      ))}
    </section>
  );
}
