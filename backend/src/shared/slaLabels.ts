/** User-facing SLA and chart labels (keep UI, email, Excel, and docs aligned). */
export const SRE_AUDIT_TEAM_SLA_LABEL = 'SRE Audit Team SLA';
export const COMPLIANCE_SLA_LABEL = 'Compliance SLA';
export const SRE_AUDIT_TEAM_SLA_BREACHES_LABEL = 'SRE Audit Team SLA breaches';
export const COMPLIANCE_SLA_BREACHES_LABEL = 'Compliance SLA breaches';
export const IN_PROGRESS_AGING_LABEL = 'In-progress aging';

export function slaKindLabel(kind: 'team' | 'reviewer'): string {
  return kind === 'team' ? SRE_AUDIT_TEAM_SLA_LABEL : COMPLIANCE_SLA_LABEL;
}
