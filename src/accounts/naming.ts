export function generateAccountId(
  type: string,
  source: 'native' | 'cliproxy',
  email?: string,
  accountIdHint?: string,
  existingIds?: Set<string>,
): string {
  let baseId: string
  
  if (source === 'native') {
    if (type === 'codex') baseId = 'codex-native'
    else if (type === 'claude') baseId = 'claude-local'
    else baseId = `${type}-native`
  } else if (email) {
    const atIndex = email.indexOf('@')
    if (atIndex > 0) {
      const local = email.substring(0, atIndex)
      const domain = email.substring(atIndex + 1).split('.')[0]
      baseId = `${type}-${local}-${domain}`
    } else {
      baseId = `${type}-${email}`
    }
  } else if (accountIdHint) {
    baseId = `${type}-${accountIdHint.substring(0, 8)}`
  } else {
    baseId = `${type}-unknown`
  }
  
  if (!existingIds || !existingIds.has(baseId)) {
    return baseId
  }
  
  let counter = 2
  while (existingIds.has(`${baseId}-${counter}`)) {
    counter++
  }
  return `${baseId}-${counter}`
}
