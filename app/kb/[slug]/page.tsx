import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listDocs, getDoc } from '@/lib/kb';
import { getEdges } from '@/lib/data';
import { LinksPanel } from '@/components/LinksPanel';
import KbNav from '../KbNav';
import { requireGlobalAdminPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function KbArticle({ params }: { params: Promise<{ slug: string }> }) {
  await requireGlobalAdminPage();
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) return notFound();

  const docs = listDocs();
  const edges = await getEdges('kb', slug);

  return (
    <div>
      <div className="crumb mb">
        <Link className="link" href="/kb">Knowledge Base</Link> · <b>{doc.title}</b>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '280px 1fr 320px' }}>
        <KbNav docs={docs} active={slug} />

        <div className="card">
          <div className="kb-prose" dangerouslySetInnerHTML={{ __html: doc.html }} />
        </div>

        <div>
          <LinksPanel edges={edges} node={{ type: 'kb', id: slug }} />
        </div>
      </div>
    </div>
  );
}
