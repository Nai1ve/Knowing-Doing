import type { SourceItem } from './product-types.js'
import type { ProductRepository } from './product-repository.js'

export interface SourceProvider {
  search(query: string, limit: number): Promise<SourceItem[]>
}

export class RetrievalService {
  constructor(private readonly repository: ProductRepository, private readonly provider?: SourceProvider) {}

  async search(query: string, limit = 5): Promise<{ status: 'retrieved' | 'empty' | 'unavailable'; items: SourceItem[] }> {
    const cached = this.repository.listSources().filter((item) => item.query?.toLowerCase().includes(query.toLowerCase())).slice(0, limit)
    if (cached.length > 0) return { status: 'retrieved', items: cached }
    if (!this.provider) return { status: 'unavailable', items: [] }
    try {
      const items = await this.provider.search(query, limit)
      for (const item of items) this.repository.saveSource(item)
      return { status: items.length > 0 ? 'retrieved' : 'empty', items }
    } catch {
      return { status: 'unavailable', items: [] }
    }
  }
}
