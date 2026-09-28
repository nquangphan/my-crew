export type RuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7';

/** One failed check, printed as `RULE path: message` (the message ends with the fix). */
export interface Violation {
  rule: RuleId;
  path: string;
  message: string;
  /** The commit that broke the rule, in range mode. */
  commit?: string;
}

export function formatViolation(violation: Violation): string {
  const where = violation.commit ? ` [commit ${violation.commit.slice(0, 7)}]` : '';
  return `${violation.rule} ${violation.path}: ${violation.message}${where}`;
}
