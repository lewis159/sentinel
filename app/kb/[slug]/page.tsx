import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listDocs, getDoc } from '@/lib/kb';
import KbNav from '../KbNav';

export const dynamic = 'force-dynamic';

export default async function KbArticle({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) return notFound();

  const docs = listDocs();

  return (
    <div>
      <div className="crumb mb">
        <Link className="link" href="/kb">Knowledge Base</Link> · <b>{doc.title}</b>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '280px 1fr' }}>
        <KbNav docs={docs} active={slug} />

        <div className="card">
          <div className="kb-prose" dangerouslySetInnerHTML={{ __html: doc.html }} />
        </div>
      </div>
    </div>
  );
}
