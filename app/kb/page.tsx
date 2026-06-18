import Link from 'next/link';
import { listDocs, getDoc } from '@/lib/kb';
import KbNav from './KbNav';

export const dynamic = 'force-dynamic';

export default function KbPage() {
  const docs = listDocs();
  const home = getDoc('index');

  return (
    <div>
      <div className="spread mb">
        <div>
          <div className="h1">Knowledge Base</div>
          <div className="sub">Living documentation — reflects the current build</div>
        </div>
        <Link href="/api/kb/export" className="btn ghost sm">⭳ Export PDF</Link>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '280px 1fr' }}>
        <KbNav docs={docs} />

        <div className="card">
          {home ? (
            <div className="kb-prose" dangerouslySetInnerHTML={{ __html: home.html }} />
          ) : (
            <div className="placeholder">
              <div className="big">📄</div>
              No <span className="mono">index.md</span> found in content/kb.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
