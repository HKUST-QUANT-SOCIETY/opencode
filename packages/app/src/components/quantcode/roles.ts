export type QuantCodeRole = "approver" | "analyst" | "admin"

/**
 * ponytail: 首版按身份名启发式（身份含 risk/风控/lead → approver，admin/管理员 → admin，
 * 其余 analyst）；将来接 authorized_groups.yaml 的 role 列后，替换这里的 pattern 匹配即可。
 * admin 权威判定源待 G4（平台侧角色服务）落地后接入。
 */
export const ROLE_RULES: readonly { role: QuantCodeRole; pattern: RegExp }[] = [
  { role: "admin", pattern: /admin|管理员|root/i },
  { role: "approver", pattern: /risk|风控|lead/i },
]

export function resolveRole(identity: string): QuantCodeRole {
  for (const rule of ROLE_RULES) {
    if (rule.pattern.test(identity)) return rule.role
  }
  return "analyst"
}

/** admin 角色可见性判定（Admin 中枢导航项仅 admin 渲染）。 */
export function isAdminRole(identity: string): boolean {
  return resolveRole(identity) === "admin"
}
