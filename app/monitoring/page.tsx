import { requireGlobalAdminPage } from '@/lib/auth';
import { Breadcrumb } from '@/components/Breadcrumb';
import { EditModeProvider, EditModeToggle } from '@/components/EditMode';
import { MonitoringDashboard } from '@/components/MonitoringDashboard';

export const dynamic = 'force-dynamic';

// Operations → Monitoring: the composable monitoring dashboard. Aggregates the
// existing tools (docker-socket-proxy topology, Prometheus CPU, Uptime Kuma,
// Sentinel incidents) into a reusable DashboardGrid. Gated to global_admin; the
// data APIs each widget calls are Clerk-gated (requireOpsAuth) too.
export default async function MonitoringPage() {
  await requireGlobalAdminPage();

  return (
    <div>
      <Breadcrumb items={[
        { label: 'Operations' },
        { label: 'Monitoring' },
      ]} />
      <EditModeProvider>
        <div className="spread mb">
          <div>
            <div className="h1">Monitoring</div>
            <div className="sub">Live topology, CPU, uptime and open incidents · aggregated read-only</div>
          </div>
          <EditModeToggle />
        </div>

        <MonitoringDashboard />
      </EditModeProvider>
    </div>
  );
}
