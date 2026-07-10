import type { Database } from '../db/database'
import type { Location } from './operators-repo'

/**
 * NOT location-scoped — a location IS the tenant root, so reading one by id is a
 * system operation (used by the agent-reply job to learn the location's reply
 * mode + client slug). Operator-facing listing stays in OperatorsRepo.listLocations,
 * which is access-gated by operator_locations.
 */
export class LocationsRepo {
  constructor(private db: Database) {}

  async getById(id: string): Promise<Location | undefined> {
    const rows = await this.db.query<Location>(
      'SELECT id, name, slug, client_slug, branding, settings FROM locations WHERE id=$1',
      [id],
    )
    return rows[0]
  }
}
