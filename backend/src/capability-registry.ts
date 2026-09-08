export interface WorkspaceCapability {
  capabilityKey: string
  templateKey: 'python-pytest-v1'
  provider: 'fixture'
  status: 'available' | 'planned'
}

const capabilities: WorkspaceCapability[] = [
  { capabilityKey: 'python.testing', templateKey: 'python-pytest-v1', provider: 'fixture', status: 'available' },
]

export function getWorkspaceCapability(capabilityKey: string): WorkspaceCapability | null {
  return capabilities.find((item) => item.capabilityKey === capabilityKey) ?? null
}

export function getWorkspaceCapabilityForTemplate(templateKey: string): WorkspaceCapability | null {
  return capabilities.find((item) => item.templateKey === templateKey) ?? null
}
