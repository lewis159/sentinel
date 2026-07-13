// Console settings SCHEMA — pure data + validation, NO server-only / DB imports.
//
// This module is safe to import from BOTH server code (the store + API) and
// client components (the settings panels), so the browser can render the right
// input for each key and the server can validate what it persists — from a
// single source of truth.
//
// CRITICAL — NONE of these definitions carries a value or a default. A setting is
// either a real value the admin has saved (loaded from ops.console_settings) or
// it is UNSET, in which case the UI shows a BLANK field. There are deliberately
// no seeded / sample / placeholder values anywhere in this file. `label` is a
// short neutral field name, never an example value.

export type SettingType = 'text' | 'boolean' | 'number' | 'select';

export type SettingDef = {
  key: string;
  type: SettingType;
  /** Section id this key belongs to (matches a SECTION id below). */
  section: string;
  /** Short, neutral field label. NOT a sample value. */
  label: string;
  /** Allowed option values for `type: 'select'` (real, closed set — not samples). */
  options?: string[];
  /** Optional integer bounds for `type: 'number'` (validation only, not a value). */
  min?: number;
  max?: number;
};

// The editable console-settings keys. NONE is seeded with a value.
export const CONSOLE_SETTINGS: SettingDef[] = [
  // --- General ---------------------------------------------------------------
  { key: 'org_name', type: 'text', section: 'general', label: 'Organisation name' },
  { key: 'console_url', type: 'text', section: 'general', label: 'Console URL' },
  { key: 'product_domain', type: 'text', section: 'general', label: 'Primary product domain' },
  { key: 'support_address', type: 'text', section: 'general', label: 'Support address' },
  { key: 'timezone', type: 'text', section: 'general', label: 'Timezone' },
  {
    key: 'default_theme',
    type: 'select',
    section: 'general',
    label: 'Default theme',
    options: ['dark', 'light', 'system'],
  },
  { key: 'env_banner_enabled', type: 'boolean', section: 'general', label: 'Environment banner' },
  { key: 'env_banner_label', type: 'text', section: 'general', label: 'Environment banner label' },
  { key: 'brand_accent', type: 'text', section: 'general', label: 'Brand accent (hex)' },

  // --- Appearance & themes ---------------------------------------------------
  {
    key: 'appearance_density',
    type: 'select',
    section: 'appearance',
    label: 'Interface density',
    options: ['comfortable', 'compact'],
  },
  { key: 'appearance_reduced_motion', type: 'boolean', section: 'appearance', label: 'Reduce motion' },

  // --- Notifications ---------------------------------------------------------
  { key: 'notify_email_enabled', type: 'boolean', section: 'notifications', label: 'Email notifications' },
  { key: 'notify_email_address', type: 'text', section: 'notifications', label: 'Notification email address' },
  { key: 'notify_slack_enabled', type: 'boolean', section: 'notifications', label: 'Slack notifications' },
  { key: 'notify_webhook_url', type: 'text', section: 'notifications', label: 'Notification webhook URL' },

  // --- SLA policies (target response hours per priority) ----------------------
  { key: 'sla_p1_hours', type: 'number', section: 'sla', label: 'P1 target (hours)', min: 0, max: 8760 },
  { key: 'sla_p2_hours', type: 'number', section: 'sla', label: 'P2 target (hours)', min: 0, max: 8760 },
  { key: 'sla_p3_hours', type: 'number', section: 'sla', label: 'P3 target (hours)', min: 0, max: 8760 },
  { key: 'sla_p4_hours', type: 'number', section: 'sla', label: 'P4 target (hours)', min: 0, max: 8760 },

  // --- Data & retention (days) -----------------------------------------------
  { key: 'retention_audit_days', type: 'number', section: 'retention', label: 'Audit log retention (days)', min: 0, max: 36500 },
  { key: 'retention_activity_days', type: 'number', section: 'retention', label: 'Activity retention (days)', min: 0, max: 36500 },
  { key: 'retention_logs_days', type: 'number', section: 'retention', label: 'Operational logs retention (days)', min: 0, max: 36500 },

  // --- Billing & plans -------------------------------------------------------
  // Billing itself is managed in Stripe; the only editable value is the URL of
  // the customer billing portal so the panel's link can point at the real one.
  { key: 'billing_portal_url', type: 'text', section: 'billing', label: 'Billing portal URL' },
];

// Sections that own an editable panel of settings (keyed by section id). The
// left-nav labels for these live in the settings page. Informational-only
// sections (SSO, Sections & navigation) intentionally have NO keys here.
export const SETTING_SECTIONS = [
  'general',
  'appearance',
  'notifications',
  'sla',
  'retention',
  'billing',
] as const;
export type SettingSection = (typeof SETTING_SECTIONS)[number];

const BY_KEY: Record<string, SettingDef> = Object.fromEntries(
  CONSOLE_SETTINGS.map((d) => [d.key, d]),
);

export function getSettingDef(key: string): SettingDef | undefined {
  return BY_KEY[key];
}

export function settingsForSection(section: string): SettingDef[] {
  return CONSOLE_SETTINGS.filter((d) => d.section === section);
}

export type ValidateResult =
  | { ok: true; value: unknown; unset: boolean }
  | { ok: false; error: string };

/**
 * Validate + normalise a single setting value against its schema definition.
 *
 * An empty / null / blank value is treated as UNSET (unset: true) — the caller
 * should DELETE the row so the field reads back blank. This is how "blank is the
 * honest default" is enforced end to end: you can always clear a value.
 *
 * Never throws; unknown keys and type mismatches return { ok: false }.
 */
export function validateSetting(key: string, raw: unknown): ValidateResult {
  const def = BY_KEY[key];
  if (!def) return { ok: false, error: `Unknown setting: ${key}` };

  // Normalise "blank" → unset for every type.
  const isBlank =
    raw === undefined ||
    raw === null ||
    (typeof raw === 'string' && raw.trim() === '');
  if (isBlank) return { ok: true, value: null, unset: true };

  switch (def.type) {
    case 'text': {
      if (typeof raw !== 'string') return { ok: false, error: `${key} must be a string` };
      return { ok: true, value: raw.trim(), unset: false };
    }
    case 'select': {
      if (typeof raw !== 'string') return { ok: false, error: `${key} must be a string` };
      const v = raw.trim();
      if (def.options && !def.options.includes(v)) {
        return { ok: false, error: `${key} must be one of: ${def.options.join(', ')}` };
      }
      return { ok: true, value: v, unset: false };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw, unset: false };
      if (raw === 'true') return { ok: true, value: true, unset: false };
      if (raw === 'false') return { ok: true, value: false, unset: false };
      return { ok: false, error: `${key} must be a boolean` };
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return { ok: false, error: `${key} must be a number` };
      if (def.min !== undefined && n < def.min) return { ok: false, error: `${key} must be >= ${def.min}` };
      if (def.max !== undefined && n > def.max) return { ok: false, error: `${key} must be <= ${def.max}` };
      return { ok: true, value: n, unset: false };
    }
    default:
      return { ok: false, error: `Unsupported type for ${key}` };
  }
}
