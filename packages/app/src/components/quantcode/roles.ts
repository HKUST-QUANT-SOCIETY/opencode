export type QuantCodeRole = "approver" | "analyst"

/**
 * ponytail: 首版按身份名启发式（身份含 risk/风控/lead → approver，其余 analyst）；
 * 将来接 authorized_groups.yaml 的 role 列后，替换这里的 pattern 匹配即可。
 */
export const ROLE_RULES: readonly { role: QuantCodeRole; pattern: RegExp }[] = [
  { role: "approver", pattern: /risk|风控|lead/i },
]

export function resolveRole(identity: string): QuantCodeRole {
  for (const rule of ROLE_RULES) {
    if (rule.pattern.test(identity)) return rule.role
  }
  return "analyst"
}