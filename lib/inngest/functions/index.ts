// Registry of all Inngest functions the serve endpoint exposes to the self-hosted
// server. Adding a function here (and it will be synced on the next register/PUT)
// is the only wiring needed — the serve route imports this array.
import { dunning } from '@/lib/inngest/functions/dunning';
import { scheduledBriefs } from '@/lib/inngest/functions/scheduled-briefs';
import { watchers } from '@/lib/inngest/functions/watchers';

export const functions = [dunning, scheduledBriefs, watchers];

export { dunning, scheduledBriefs, watchers };
