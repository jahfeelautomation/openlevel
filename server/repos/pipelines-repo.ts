import { nanoid } from 'nanoid'
import { LocationScopedRepo } from './base-repo'

export interface Pipeline {
  id: string
  location_id: string
  name: string
  position: number
  created_at: string
}

export interface Stage {
  id: string
  location_id: string
  pipeline_id: string
  name: string
  position: number
  created_at: string
}

export interface PipelineWithStages extends Pipeline {
  stages: Stage[]
}

/**
 * Result of a guarded delete. The repo refuses destructive deletes rather than
 * silently cascading: a location must keep at least one pipeline, a pipeline must
 * keep at least one stage, and neither a pipeline nor a stage that still holds
 * opportunities can be removed (the operator moves or closes the deals first).
 * The route maps each reason to an honest HTTP status and message.
 */
export type DeleteResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'last_pipeline' | 'last_stage' | 'has_opportunities' }

export class PipelinesRepo extends LocationScopedRepo {
  /** All pipelines for the location, each with its ordered stages nested. */
  async listWithStages(): Promise<PipelineWithStages[]> {
    const pipelines = await this.scopedSelect<Pipeline>('SELECT * FROM pipelines ORDER BY position')
    const stages = await this.scopedSelect<Stage>('SELECT * FROM pipeline_stages ORDER BY position')
    return pipelines.map((p) => ({
      ...p,
      stages: stages.filter((s) => s.pipeline_id === p.id),
    }))
  }

  async get(id: string): Promise<Pipeline | undefined> {
    const rows = await this.scopedSelect<Pipeline>('SELECT * FROM pipelines WHERE id=$2', [id])
    return rows[0]
  }

  // --- pipelines: management ----------------------------------------------

  /**
   * Create a pipeline at the next position and seed it with one default stage so
   * the board is immediately usable (GHL never leaves a pipeline stage-less). The
   * caller gets back the ready-to-use pipeline with its single stage nested.
   */
  async createPipeline(name: string): Promise<PipelineWithStages> {
    const id = nanoid()
    const rows = await this.scopedWrite<Pipeline>(
      `INSERT INTO pipelines (id, location_id, name, position)
       VALUES ($2, $1, $3, COALESCE((SELECT MAX(position) + 1 FROM pipelines WHERE location_id = $1), 0))
       RETURNING *`,
      [id, name],
    )
    const pipeline = rows[0]!
    const stage = await this.addStage(id, 'New Stage')
    return { ...pipeline, stages: [stage] }
  }

  async renamePipeline(id: string, name: string): Promise<Pipeline | undefined> {
    const rows = await this.scopedWrite<Pipeline>(
      `UPDATE pipelines SET name=$2 WHERE location_id=$1 AND id=$3 RETURNING *`,
      [name, id],
    )
    return rows[0]
  }

  /**
   * Delete a pipeline only when it is safe: it must exist, it must not be the
   * location's only pipeline, and it must not still hold opportunities. Deleting
   * cascades its stages at the DB layer, but we refuse rather than wipe live deals.
   */
  async removePipeline(id: string): Promise<DeleteResult> {
    const existing = await this.get(id)
    if (!existing) return { ok: false, reason: 'not_found' }

    const all = await this.scopedSelect<{ id: string }>('SELECT id FROM pipelines')
    if (all.length <= 1) return { ok: false, reason: 'last_pipeline' }

    const opps = await this.scopedSelect<{ id: string }>(
      'SELECT id FROM opportunities WHERE pipeline_id=$2 LIMIT 1',
      [id],
    )
    if (opps.length > 0) return { ok: false, reason: 'has_opportunities' }

    await this.scopedWrite('DELETE FROM pipelines WHERE location_id=$1 AND id=$2', [id])
    return { ok: true }
  }

  // --- stages: management --------------------------------------------------

  async getStage(id: string): Promise<Stage | undefined> {
    const rows = await this.scopedSelect<Stage>('SELECT * FROM pipeline_stages WHERE id=$2', [id])
    return rows[0]
  }

  listStages(pipelineId: string): Promise<Stage[]> {
    return this.scopedSelect<Stage>(
      'SELECT * FROM pipeline_stages WHERE pipeline_id=$2 ORDER BY position',
      [pipelineId],
    )
  }

  async addStage(pipelineId: string, name: string): Promise<Stage> {
    const id = nanoid()
    const rows = await this.scopedWrite<Stage>(
      `INSERT INTO pipeline_stages (id, location_id, pipeline_id, name, position)
       VALUES ($2, $1, $3, $4,
         COALESCE((SELECT MAX(position) + 1 FROM pipeline_stages WHERE location_id = $1 AND pipeline_id = $3), 0))
       RETURNING *`,
      [id, pipelineId, name],
    )
    return rows[0]!
  }

  async renameStage(id: string, name: string): Promise<Stage | undefined> {
    const rows = await this.scopedWrite<Stage>(
      `UPDATE pipeline_stages SET name=$2 WHERE location_id=$1 AND id=$3 RETURNING *`,
      [name, id],
    )
    return rows[0]
  }

  /** Persist a new stage order: write position = index for each id, in order. */
  async reorderStages(pipelineId: string, orderedIds: string[]): Promise<Stage[]> {
    for (const [i, sid] of orderedIds.entries()) {
      await this.scopedWrite(
        `UPDATE pipeline_stages SET position=$2 WHERE location_id=$1 AND id=$3 AND pipeline_id=$4`,
        [i, sid, pipelineId],
      )
    }
    return this.listStages(pipelineId)
  }

  /**
   * Delete a stage only when it is safe: it must exist, it must not be the
   * pipeline's only stage, and it must not still hold opportunities.
   */
  async removeStage(id: string): Promise<DeleteResult> {
    const stage = await this.getStage(id)
    if (!stage) return { ok: false, reason: 'not_found' }

    const siblings = await this.scopedSelect<{ id: string }>(
      'SELECT id FROM pipeline_stages WHERE pipeline_id=$2',
      [stage.pipeline_id],
    )
    if (siblings.length <= 1) return { ok: false, reason: 'last_stage' }

    const opps = await this.scopedSelect<{ id: string }>(
      'SELECT id FROM opportunities WHERE stage_id=$2 LIMIT 1',
      [id],
    )
    if (opps.length > 0) return { ok: false, reason: 'has_opportunities' }

    await this.scopedWrite('DELETE FROM pipeline_stages WHERE location_id=$1 AND id=$2', [id])
    return { ok: true }
  }
}
