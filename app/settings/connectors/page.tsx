import { listConnectors } from '@/lib/connectors';
import ConnectorForm from '@/components/ConnectorForm';
import { requireGlobalAdminPage } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type Field = { key: string; label: string; secret?: boolean };
type CatItem = { type: string; label: string; desc: string; icon: string; fields: Field[]; functional?: boolean };

const CATALOGUE: CatItem[] = [
  {
    type: 'supabase',
    label: 'Supabase (YT Transcriber data)',
    desc: 'Pull real YT Transcriber users & videos.',
    icon: '🗄️',
    functional: true,
    fields: [
      { key: 'url', label: 'Project URL' },
      { key: 'key', label: 'Service key', secret: true },
    ],
  },
  {
    type: 'docker',
    label: 'Docker (socket-proxy)',
    desc: 'Container & infra monitoring.',
    icon: '🐳',
    fields: [{ key: 'host', label: 'Host (e.g. tcp://docker-socket-proxy:2375)' }],
  },
  {
    type: 'hermes',
    label: 'Hermes AI (Ollama)',
    desc: 'AI orchestration / enrichment.',
    icon: '🤖',
    fields: [{ key: 'url', label: 'Base URL' }],
  },
  {
    type: 'email',
    label: 'Email / SMTP',
    desc: 'Outbound alert delivery.',
    icon: '✉️',
    fields: [
      { key: 'host', label: 'SMTP host' },
      { key: 'user', label: 'Username' },
      { key: 'password', label: 'Password', secret: true },
    ],
  },
  {
    type: 'slack',
    label: 'Slack',
    desc: 'Channel notifications.',
    icon: '💬',
    fields: [{ key: 'webhook', label: 'Incoming webhook URL', secret: true }],
  },
  {
    type: 'telegram',
    label: 'Telegram',
    desc: 'Bot notifications.',
    icon: '📨',
    fields: [
      { key: 'botToken', label: 'Bot token', secret: true },
      { key: 'chatId', label: 'Chat ID' },
    ],
  },
];

export default async function ConnectorsPage() {
  await requireGlobalAdminPage();
  const saved = await listConnectors();
  const byType = new Map(saved.map((c) => [c.type, c]));

  return (
    <div>
      <div className="spread mb">
        <div>
          <div className="h1">Connectors</div>
          <div className="sub">Configure how Sentinel connects to external systems</div>
        </div>
      </div>

      <div className="grid grid-2">
        {CATALOGUE.map((cat) => {
          const existing = byType.get(cat.type) ?? null;
          const configured = !!existing && existing.status === 'configured';
          const enabled = !!existing?.enabled;

          return (
            <div key={cat.type} className="card">
              <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: 34, height: 34, borderRadius: 8, background: 'var(--panel-2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16,
                  }}
                >
                  {cat.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span className="t" style={{ fontWeight: 700 }}>{cat.label}</span>
                    {!cat.functional && (
                      <span className="pill sev-info">Preview</span>
                    )}
                  </div>
                  <div className="sub" style={{ marginTop: 4 }}>{cat.desc}</div>
                </div>
                {configured && enabled ? (
                  <span className="pill" style={{ background: 'rgba(51,184,122,.14)', color: '#5fd49b' }}>
                    <span className="dot" style={{ background: 'var(--ok)' }} />Configured · Enabled
                  </span>
                ) : configured ? (
                  <span className="pill sev-info"><span className="dot" style={{ background: 'var(--muted)' }} />Configured · Off</span>
                ) : (
                  <span className="pill sev-info"><span className="dot" style={{ background: 'var(--muted)' }} />Not configured</span>
                )}
              </div>

              <ConnectorForm
                type={cat.type}
                label={cat.label}
                fields={cat.fields}
                existing={existing ? { name: existing.name, config: existing.config, enabled: existing.enabled } : null}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
