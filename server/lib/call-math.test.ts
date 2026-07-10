import { describe, expect, it } from 'vitest'
import { callStats } from './call-math'

const call = (direction: string, status: string, duration_seconds: number | null = null) => ({
  direction,
  status,
  duration_seconds,
})

describe('callStats', () => {
  it('an empty log is an honest zero — no invented rates or averages', () => {
    expect(callStats([])).toEqual({
      total: 0,
      inbound: 0,
      outbound: 0,
      completed: 0,
      connectedRate: 0,
      avgDurationSeconds: 0,
    })
  })

  it('splits directions and counts only real completions', () => {
    const stats = callStats([
      call('outbound', 'completed', 120),
      call('outbound', 'no-answer'),
      call('inbound', 'completed', 60),
      call('outbound', 'failed'),
    ])
    expect(stats.total).toBe(4)
    expect(stats.inbound).toBe(1)
    expect(stats.outbound).toBe(3)
    expect(stats.completed).toBe(2)
    expect(stats.connectedRate).toBe(50)
  })

  it('averages duration only over calls that actually reported one', () => {
    const stats = callStats([
      call('outbound', 'completed', 100),
      call('outbound', 'completed', 50),
      call('outbound', 'queued'), // still running — no duration yet
    ])
    expect(stats.avgDurationSeconds).toBe(75)
  })

  it('rounds the rate to a whole percent', () => {
    const stats = callStats([call('outbound', 'completed'), call('outbound', 'busy'), call('outbound', 'busy')])
    expect(stats.connectedRate).toBe(33)
  })
})
