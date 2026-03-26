import { expect, it } from 'vitest'
import * as helper from './testHelper.ts'
import { ctx } from './hooks.ts'
import { delay } from '../src/tools.ts'

describe('workRoundRobin speed', function () {
  const queueCount = 1000
  const jobsPerQueue = 2
  const timeout = 10_000
  const workers = 100
  const totalJobs = queueCount * jobsPerQueue

  it(`should process ${totalJobs} jobs across ${queueCount} queues in ${timeout / 1000} seconds with ${workers} workers`, { timeout: timeout + 5000 }, async function () {
    const config = { ...ctx.bossConfig, min: workers, max: workers }
    ctx.boss = await helper.start(config)

    const queues: string[] = [ctx.schema]
    for (let i = 1; i < queueCount; i++) {
      const name = `${ctx.schema}_q${i}`
      await ctx.boss.createQueue(name)
      queues.push(name)
    }

    for (const q of queues) {
      const rows = Array.from({ length: jobsPerQueue }, (_, j) => ({ name: q, data: { j } }))
      await ctx.boss.insert(q, rows)
    }

    let processed = 0

    await ctx.boss.workRoundRobin(
      () => queues,
      {
        pollingIntervalSeconds: 0.5,
        localConcurrency: workers,
      },
      async jobs => {
        processed += jobs.length
      }
    )

    await delay(timeout)

    expect(processed).toBe(totalJobs)
  })
})
