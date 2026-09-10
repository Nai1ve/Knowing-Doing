import { getEnvironmentCapability, getEnvironmentCapabilityForTemplate, getEnvironmentTemplate, type EnvironmentCapability } from './environment-registry.js'

export interface WorkspaceCapability extends EnvironmentCapability {
  templateKey: string
}

export function getWorkspaceCapability(capabilityKey: string): WorkspaceCapability | null {
  const item = getEnvironmentCapability(capabilityKey)
  if (!item || item.status !== 'available' || getEnvironmentTemplate(item.environmentKey)?.runtimeKind !== 'docker_workspace') return null
  return { ...item, templateKey: item.environmentKey }
}

export function getWorkspaceCapabilityForTemplate(templateKey: string): WorkspaceCapability | null {
  const item = getEnvironmentCapabilityForTemplate(templateKey)
  return item && item.status === 'available' && getEnvironmentTemplate(item.environmentKey)?.runtimeKind === 'docker_workspace'
    ? { ...item, templateKey: item.environmentKey }
    : null
}
