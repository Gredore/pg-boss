import { expect } from 'vitest'
import * as helper from './testHelper.ts'
import { assertTruthy } from './testHelper.ts'
import { delay } from '../src/tools.ts'
import { ctx } from './hooks.ts'

describe('workRoundRobin', function () {
  it('should fail with no arguments', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)
    await expect(async () => {
      // @ts-ignore
      await ctx.boss.workRoundRobin()
    }).rejects.toThrow()
  })

  it('should fail if no callback provided', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)
    await expect(async () => {
      // @ts-ignore
      await ctx.boss.workRoundRobin(['foo'])
    }).rejects.toThrow()
  })

  it('should fail if options is not an object', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)
    await expect(async () => {
      // @ts-ignore
      await ctx.boss.workRoundRobin(['foo'], async () => {}, 'nope')
    }).rejects.toThrow()
  })

  it('offWork should fail without a name', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)
    await expect(async () => {
      // @ts-ignore
      await ctx.boss.offWork()
    }).rejects.toThrow()
  })

  it('should honor a custom polling interval', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)

    const pollingIntervalSeconds = 1
    const timeout = 5000
    let processCount = 0
    const jobCount = 10

    for (let i = 0; i < jobCount; i++) {
      await ctx.boss.send(ctx.schema)
    }

    await ctx.boss.workRoundRobin([ctx.schema], { pollingIntervalSeconds }, async () => {
      processCount++
    })

    await delay(timeout)

    expect(processCount).toBe(timeout / 1000 / pollingIntervalSeconds)
  })

  it('should provide abort signal to job handler', async function () {
    ctx.boss = await helper.start({ ...ctx.bossConfig, __test__enableSpies: true })

    const spy = ctx.boss.getSpy(ctx.schema)
    let receivedSignal = {}

    const jobId = await ctx.boss.send(ctx.schema)

    await ctx.boss.workRoundRobin([ctx.schema], async ([job]) => {
      receivedSignal = job.signal
    })

    assertTruthy(jobId)
    await spy.waitForJobWithId(jobId, 'completed')

    expect(receivedSignal).toBeInstanceOf(AbortSignal)
  })

  it('should honor when a worker is notified', async function () {
    ctx.boss = await helper.start({ ...ctx.bossConfig, __test__enableSpies: true })

    const spy = ctx.boss.getSpy(ctx.schema)
    let processCount = 0

    const jobId1 = await ctx.boss.send(ctx.schema)

    const workerId = await ctx.boss.workRoundRobin([ctx.schema], { pollingIntervalSeconds: 5 }, async () => processCount++)

    assertTruthy(jobId1)
    await spy.waitForJobWithId(jobId1, 'completed')

    expect(processCount).toBe(1)

    const jobId2 = await ctx.boss.send(ctx.schema)

    ctx.boss.notifyWorker(workerId)

    assertTruthy(jobId2)
    await spy.waitForJobWithId(jobId2, 'completed')

    expect(processCount).toBe(2)
  })

  it('should remove a worker', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)

    let receivedCount = 0

    ctx.boss.workRoundRobin([ctx.schema], async () => {
      receivedCount++
      await ctx.boss!.offWork('__roundrobin__')
    })

    await ctx.boss.send(ctx.schema)
    await ctx.boss.send(ctx.schema)

    await delay(5000)

    expect(receivedCount).toBe(1)
  })

  it('should remove a worker by id', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)

    let receivedCount = 0

    await ctx.boss.send(ctx.schema)
    await ctx.boss.send(ctx.schema)

    const id = await ctx.boss.workRoundRobin([ctx.schema], { pollingIntervalSeconds: 0.5 }, async () => {
      receivedCount++
      await ctx.boss!.offWork('__roundrobin__', { id })
    })

    await delay(2000)

    expect(receivedCount).toBe(1)
  })

  it('should handle a batch of jobs via batchSize', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)

    const batchSize = 4

    for (let i = 0; i < batchSize; i++) {
      await ctx.boss.send(ctx.schema)
    }

    return new Promise<void>((resolve) => {
      ctx.boss!.workRoundRobin([ctx.schema], { batchSize }, async jobs => {
        expect(jobs.length).toBe(batchSize)
        resolve()
      })
    })
  })

  it('batchSize should auto-complete the jobs', async function () {
    ctx.boss = await helper.start({ ...ctx.bossConfig, __test__enableSpies: true })

    const spy = ctx.boss.getSpy(ctx.schema)
    const jobId = await ctx.boss.send(ctx.schema)

    await ctx.boss.workRoundRobin([ctx.schema], { batchSize: 1 }, async jobs => {
      expect(jobs.length).toBe(1)
    })

    assertTruthy(jobId)
    const job = await spy.waitForJobWithId(jobId, 'completed')

    expect(job.state).toBe('completed')
  })

  it('returning promise applies backpressure', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)

    const jobCount = 4
    let processCount = 0

    for (let i = 0; i < jobCount; i++) {
      await ctx.boss.send(ctx.schema)
    }

    await ctx.boss.workRoundRobin([ctx.schema], async () => {
      await delay(2000)
      processCount++
    })

    await delay(7000)

    expect(processCount).toBeLessThan(jobCount)
  })

  it('completion should pass string wrapped in value prop', async function () {
    ctx.boss = await helper.start({ ...ctx.bossConfig, __test__enableSpies: true })

    const spy = ctx.boss.getSpy(ctx.schema)
    const result = 'success'

    const jobId = await ctx.boss.send(ctx.schema)

    await ctx.boss.workRoundRobin([ctx.schema], async () => result)

    assertTruthy(jobId)
    await spy.waitForJobWithId(jobId, 'completed')

    const job = await ctx.boss.getJobById(ctx.schema, jobId)

    assertTruthy(job)
    expect(job.state).toBe('completed')
    expect((job.output as { value: string }).value).toBe(result)
  })

  it('handler result should be stored in output', async function () {
    ctx.boss = await helper.start({ ...ctx.bossConfig, __test__enableSpies: true })
    const something = 'clever'

    const spy = ctx.boss.getSpy(ctx.schema)

    const jobId = await ctx.boss.send(ctx.schema)
    await ctx.boss.workRoundRobin([ctx.schema], async () => ({ something }))

    assertTruthy(jobId)
    const job = await spy.waitForJobWithId(jobId, 'completed')

    expect(job.state).toBe('completed')
    expect((job.output as { something: string }).something).toBe(something)
  })

  it('job can be deleted in handler', async function () {
    ctx.boss = await helper.start({ ...ctx.bossConfig, __test__enableSpies: true })

    const spy = ctx.boss.getSpy(ctx.schema)
    const jobId = await ctx.boss.send(ctx.schema)

    expect(jobId).toBeTruthy()

    await ctx.boss.workRoundRobin([ctx.schema], async ([job]) => ctx.boss!.deleteJob(ctx.schema, job.id))

    assertTruthy(jobId)
    await spy.waitForJobWithId(jobId, 'completed')

    const job = await ctx.boss.getJobById(ctx.schema, jobId)

    expect(job).toBeFalsy()
  })

  it('should allow multiple workers to the same queues per instance', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)

    await ctx.boss.workRoundRobin([ctx.schema], async () => {})
    await ctx.boss.workRoundRobin([ctx.schema], async () => {})
  })

  it('should honor the includeMetadata option', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)

    await ctx.boss.send(ctx.schema)

    return new Promise<void>((resolve) => {
      ctx.boss!.workRoundRobin([ctx.schema], { includeMetadata: true }, async ([job]) => {
        expect(job.startedOn).toBeDefined()
        resolve()
      })
    })
  })

  it('should fail job at expiration in worker', async function () {
    ctx.boss = await helper.start({ ...ctx.bossConfig, supervise: false })

    const jobId = await ctx.boss.send(ctx.schema, null, { retryLimit: 0, expireInSeconds: 1 })

    await ctx.boss.workRoundRobin([ctx.schema], () => delay(2000))

    await delay(2000)

    assertTruthy(jobId)
    const job = await ctx.boss.getJobById(ctx.schema, jobId)

    assertTruthy(job)
    expect(job.state).toBe('failed')
    expect((job.output as any).message).toContain('handler execution exceeded')
  })

  it('should fail a batch of jobs at expiration in worker', async function () {
    ctx.boss = await helper.start({ ...ctx.bossConfig, supervise: false })

    const jobId1 = await ctx.boss.send(ctx.schema, null, { retryLimit: 0, expireInSeconds: 1 })
    const jobId2 = await ctx.boss.send(ctx.schema, null, { retryLimit: 0, expireInSeconds: 1 })

    await ctx.boss.workRoundRobin([ctx.schema], { batchSize: 2 }, () => delay(2000))

    await delay(2000)

    assertTruthy(jobId1)
    assertTruthy(jobId2)
    const job1 = await ctx.boss.getJobById(ctx.schema, jobId1)
    const job2 = await ctx.boss.getJobById(ctx.schema, jobId2)

    assertTruthy(job1)
    expect(job1.state).toBe('failed')
    expect((job1.output as any).message).toContain('handler execution exceeded')

    assertTruthy(job2)
    expect(job2.state).toBe('failed')
    expect((job2.output as any).message).toContain('handler execution exceeded')
  })

  it('should emit wip event every 2s for workers', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)

    const firstWipEvent = new Promise<Array<any>>(resolve => ctx.boss!.once('wip', resolve))

    await ctx.boss.send(ctx.schema)

    await ctx.boss.workRoundRobin([ctx.schema], { pollingIntervalSeconds: 1 }, () => delay(2000))

    const wip1 = await firstWipEvent

    await ctx.boss.send(ctx.schema)

    expect(wip1.length).toBe(1)

    const secondWipEvent = new Promise<Array<any>>(resolve => ctx.boss!.once('wip', resolve))

    const wip2 = await secondWipEvent

    expect(wip2.length).toBe(1)
  })

  it('should reject workRoundRobin() after stopping', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)

    await ctx.boss.stop()

    await expect(async () => {
      await ctx.boss!.workRoundRobin([ctx.schema], async () => {})
    }).rejects.toThrow()
  })

  it('should allow send() after stopping', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)

    ctx.boss.stop({ close: false })

    await ctx.boss.send(ctx.schema)
  })

  it('should abort signal when graceful shutdown timeout expires', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)

    let signalAborted = false

    const jobId = await ctx.boss.send(ctx.schema, null, { retryLimit: 0 })

    assertTruthy(jobId)

    await ctx.boss.workRoundRobin([ctx.schema], async ([job]) => {
      await new Promise<void>(resolve => {
        job.signal.addEventListener('abort', () => {
          signalAborted = true
          resolve()
        }, { once: true })
      })
    })

    await delay(500)

    await ctx.boss.stop({ timeout: 1000 })

    await ctx.boss.start()

    const [job] = await ctx.boss.findJobs(ctx.schema, { id: jobId })

    assertTruthy(job)

    expect(signalAborted).toBe(true)
    expect(job.state).toBe('failed')
    expect(job.output).toBeTruthy()
  })

  it('should complete job successfully when finished within graceful shutdown period', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)

    let signalAborted = false

    const jobId = await ctx.boss.send(ctx.schema, null, { retryLimit: 0 })

    await ctx.boss.workRoundRobin([ctx.schema], async ([job]) => {
      await delay(500)
      signalAborted = job.signal.aborted
    })

    await delay(100)

    await ctx.boss.stop({ timeout: 5000 })

    await ctx.boss.start()

    assertTruthy(jobId)
    const job = await ctx.boss.getJobById(ctx.schema, jobId)

    assertTruthy(job)
    expect(signalAborted).toBe(false)
    expect(job.state).toBe('completed')
  })

  it('should abort signal immediately when graceful is false', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)

    let signalAborted = false
    let handlerStarted = false

    const jobId = await ctx.boss.send(ctx.schema, null, { retryLimit: 0 })

    await ctx.boss.workRoundRobin([ctx.schema], async ([job]) => {
      handlerStarted = true
      await delay(2000)
      signalAborted = job.signal.aborted
    })

    await delay(500)
    expect(handlerStarted).toBe(true)

    await ctx.boss.stop({ graceful: false, close: false })

    await delay(2000)

    await ctx.boss.start()

    assertTruthy(jobId)
    const job = await ctx.boss.getJobById<{}>(ctx.schema, jobId)

    assertTruthy(job)
    expect(job.state).toBe('failed')
    // @ts-expect-error untyped object
    expect((job.output)?.value).toBe('pg-boss shut down while active')
    expect(signalAborted).toBe(true)
  })

  it('should fire abort signal with multiple workers (localConcurrency)', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)

    const localConcurrency = 3
    const abortedJobs: string[] = []
    const jobIds: (string | null)[] = []

    for (let i = 0; i < 3; i++) {
      const jobId = await ctx.boss.send(ctx.schema, { index: i }, { retryLimit: 0 })
      jobIds.push(jobId)
    }

    await ctx.boss.workRoundRobin([ctx.schema], { localConcurrency, pollingIntervalSeconds: 0.5 }, async ([job]) => {
      for (let i = 0; i < 100; i++) {
        if (job.signal.aborted) {
          abortedJobs.push(job.id)
          return
        }
        await delay(100)
      }
    })

    await delay(500)

    await ctx.boss.stop({ timeout: 1000 })

    await delay(500)

    expect(abortedJobs.length).toBe(3)

    await ctx.boss.start()

    for (let i = 0; i < 3; i++) {
      const jobId = jobIds[i]
      assertTruthy(jobId)
      // @ts-ignore
      const job = await ctx.boss.getJobById(ctx.schema, jobId)
      assertTruthy(job)
      expect(job.state).toBe('failed')
      expect(job.output).toBeTruthy()
    }
  })

  // --- round-robin-specific validation tests ---

  it('should fail if names is not an array', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)
    await expect(async () => {
      // @ts-ignore
      await ctx.boss.workRoundRobin('not-an-array', async () => {})
    }).rejects.toThrow()
  })

  it('should fail if names array is empty', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)
    await expect(async () => {
      await ctx.boss!.workRoundRobin([], async () => {})
    }).rejects.toThrow()
  })

  it('should reject localGroupConcurrency option', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)
    await expect(async () => {
      // @ts-ignore
      await ctx.boss.workRoundRobin([ctx.schema], { localGroupConcurrency: 1 }, async () => {})
    }).rejects.toThrow('localGroupConcurrency is not supported')
  })

  it('should reject groupConcurrency option', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)
    await expect(async () => {
      // @ts-ignore
      await ctx.boss.workRoundRobin([ctx.schema], { groupConcurrency: 1 }, async () => {})
    }).rejects.toThrow('groupConcurrency is not supported')
  })

  // --- round-robin behavior tests ---

  it('should round-robin across multiple queues', async function () {
    ctx.boss = await helper.start({ ...ctx.bossConfig, __test__enableSpies: true })

    const queueA = ctx.schema
    const queueB = ctx.schema + '_b'
    await ctx.boss.createQueue(queueB)

    const spyA = ctx.boss.getSpy(queueA)
    const spyB = ctx.boss.getSpy(queueB)

    const jobIdA = await ctx.boss.send(queueA, { source: 'a' })
    const jobIdB = await ctx.boss.send(queueB, { source: 'b' })

    const processed: string[] = []

    await ctx.boss.workRoundRobin([queueA, queueB], { pollingIntervalSeconds: 0.5 }, async ([job]) => {
      processed.push((job.data as any).source)
    })

    assertTruthy(jobIdA)
    assertTruthy(jobIdB)
    await spyA.waitForJobWithId(jobIdA, 'completed')
    await spyB.waitForJobWithId(jobIdB, 'completed')

    expect(processed).toContain('a')
    expect(processed).toContain('b')
    expect(processed.length).toBe(2)
  })

  it('should advance to next queue after fetching from one', async function () {
    ctx.boss = await helper.start({ ...ctx.bossConfig, __test__enableSpies: true })

    const queueA = ctx.schema
    const queueB = ctx.schema + '_b'
    await ctx.boss.createQueue(queueB)

    const spyA = ctx.boss.getSpy(queueA)
    const spyB = ctx.boss.getSpy(queueB)

    const jobIdA1 = await ctx.boss.send(queueA, { source: 'a1' })
    const jobIdA2 = await ctx.boss.send(queueA, { source: 'a2' })
    const jobIdB1 = await ctx.boss.send(queueB, { source: 'b1' })

    const processed: string[] = []

    await ctx.boss.workRoundRobin([queueA, queueB], { pollingIntervalSeconds: 0.5 }, async ([job]) => {
      processed.push((job.data as any).source)
    })

    assertTruthy(jobIdA1)
    assertTruthy(jobIdA2)
    assertTruthy(jobIdB1)
    await spyA.waitForJobWithId(jobIdA1, 'completed')
    await spyB.waitForJobWithId(jobIdB1, 'completed')
    await spyA.waitForJobWithId(jobIdA2, 'completed')

    expect(processed.length).toBe(3)
    expect(processed[0]).toBe('a1')
    expect(processed[1]).toBe('b1')
    expect(processed[2]).toBe('a2')
  })

  it('should skip empty queues and fetch from next', async function () {
    ctx.boss = await helper.start({ ...ctx.bossConfig, __test__enableSpies: true })

    const queueA = ctx.schema
    const queueB = ctx.schema + '_b'
    await ctx.boss.createQueue(queueB)

    const spyB = ctx.boss.getSpy(queueB)

    const jobIdB = await ctx.boss.send(queueB, { source: 'b' })

    const processed: string[] = []

    await ctx.boss.workRoundRobin([queueA, queueB], { pollingIntervalSeconds: 0.5 }, async ([job]) => {
      processed.push((job.data as any).source)
    })

    assertTruthy(jobIdB)
    await spyB.waitForJobWithId(jobIdB, 'completed')

    expect(processed).toContain('b')
    expect(processed.length).toBe(1)
  })

  it('should process jobs from all queues fairly', async function () {
    ctx.boss = await helper.start({ ...ctx.bossConfig, __test__enableSpies: true })

    const queueA = ctx.schema
    const queueB = ctx.schema + '_b'
    const queueC = ctx.schema + '_c'
    await ctx.boss.createQueue(queueB)
    await ctx.boss.createQueue(queueC)

    const spyA = ctx.boss.getSpy(queueA)
    const spyB = ctx.boss.getSpy(queueB)
    const spyC = ctx.boss.getSpy(queueC)

    const jobsPerQueue = 3
    const allJobIds: { queue: string, id: string }[] = []

    for (let i = 0; i < jobsPerQueue; i++) {
      const idA: string | null = await ctx.boss.send(queueA, { queue: 'a', index: i })
      assertTruthy(idA)
      const idB: string | null = await ctx.boss.send(queueB, { queue: 'b', index: i })
      assertTruthy(idB)
      const idC: string | null = await ctx.boss.send(queueC, { queue: 'c', index: i })
      assertTruthy(idC)
      allJobIds.push({ queue: queueA, id: idA }, { queue: queueB, id: idB }, { queue: queueC, id: idC })
    }

    const processed: string[] = []

    await ctx.boss.workRoundRobin([queueA, queueB, queueC], { pollingIntervalSeconds: 0.5 }, async ([job]) => {
      processed.push((job.data as any).queue)
    })

    for (const { queue, id } of allJobIds) {
      const spy = queue === queueA ? spyA : queue === queueB ? spyB : spyC
      await spy.waitForJobWithId(id, 'completed')
    }

    expect(processed.length).toBe(jobsPerQueue * 3)
    expect(processed.filter(q => q === 'a').length).toBe(jobsPerQueue)
    expect(processed.filter(q => q === 'b').length).toBe(jobsPerQueue)
    expect(processed.filter(q => q === 'c').length).toBe(jobsPerQueue)
  })

  it('should stop round-robin worker by fixed name', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)

    const queueA = ctx.schema
    const queueB = ctx.schema + '_b'
    await ctx.boss.createQueue(queueB)

    let receivedCount = 0

    ctx.boss.workRoundRobin([queueA, queueB], async () => {
      receivedCount++
      await ctx.boss!.offWork('__roundrobin__')
    })

    await ctx.boss.send(queueA)
    await ctx.boss.send(queueB)

    await delay(5000)

    expect(receivedCount).toBe(1)
  })

  it('should remove round-robin worker by id', async function () {
    ctx.boss = await helper.start(ctx.bossConfig)

    const queueA = ctx.schema
    const queueB = ctx.schema + '_b'
    await ctx.boss.createQueue(queueB)

    let receivedCount = 0

    await ctx.boss.send(queueA)
    await ctx.boss.send(queueB)

    const id = await ctx.boss.workRoundRobin([queueA, queueB], { pollingIntervalSeconds: 0.5 }, async () => {
      receivedCount++
      await ctx.boss!.offWork('__roundrobin__', { id })
    })

    await delay(2000)

    expect(receivedCount).toBe(1)
  })

  it('should pick up new queues when the names array is mutated', async function () {
    ctx.boss = await helper.start({ ...ctx.bossConfig, __test__enableSpies: true })

    const queueA = ctx.schema
    const queueB = ctx.schema + '_b'
    await ctx.boss.createQueue(queueB)

    const spyA = ctx.boss.getSpy(queueA)
    const spyB = ctx.boss.getSpy(queueB)

    const names = [queueA]
    const processed: string[] = []

    const jobIdA = await ctx.boss.send(queueA, { source: 'a' })

    await ctx.boss.workRoundRobin(names, { pollingIntervalSeconds: 0.5 }, async ([job]) => {
      processed.push((job.data as any).source)
    })

    assertTruthy(jobIdA)
    await spyA.waitForJobWithId(jobIdA, 'completed')

    expect(processed).toEqual(['a'])

    const jobIdB = await ctx.boss.send(queueB, { source: 'b' })

    names.push(queueB)

    assertTruthy(jobIdB)
    await spyB.waitForJobWithId(jobIdB, 'completed')

    expect(processed).toContain('b')
    expect(processed.length).toBe(2)
  })
})
