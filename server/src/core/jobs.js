// Background jobs — bounded-concurrency queue so long work (missions,
// investigations, renders) never blocks API requests or starves chat.
// In-process (no Redis needed at this scale); statuses: queued → running →
// completed | failed | cancelled. Queue depth is observable for monitoring.

import { emit } from './events.js';

const MAX_CONCURRENT = Number(process.env.METALOID_JOB_CONCURRENCY || 4);
const MAX_JOBS = 200;

let seq = 0;
const jobs = new Map(); // id -> job
let running = 0;
const queue = [];

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    running += 1;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    emit('job.started', { id: job.id, kind: job.kind, user: job.userId });
    Promise.resolve()
      .then(() => job.fn())
      .then((result) => {
        job.status = 'completed';
        job.result = result === undefined ? null : result;
        job.endedAt = new Date().toISOString();
        emit('job.completed', { id: job.id, kind: job.kind, user: job.userId });
      })
      .catch((e) => {
        job.status = 'failed';
        job.error = String((e && e.message) || e).slice(0, 300);
        job.endedAt = new Date().toISOString();
        emit('job.failed', { id: job.id, kind: job.kind, user: job.userId });
      })
      .finally(() => {
        running -= 1;
        if (jobs.size > MAX_JOBS) {
          const oldest = [...jobs.values()].find((j) => ['completed', 'failed', 'cancelled'].includes(j.status));
          if (oldest) jobs.delete(oldest.id);
        }
        pump();
      });
  }
}

export function submitJob(userId, kind, label, fn) {
  if (!userId) throw new Error('userId required');
  const job = {
    id: `job-${Date.now().toString(36)}-${(++seq).toString(36)}`,
    userId, kind, label: String(label || kind).slice(0, 160),
    status: 'queued', createdAt: new Date().toISOString(),
    startedAt: null, endedAt: null, result: null, error: null,
    fn,
  };
  jobs.set(job.id, job);
  queue.push(job);
  emit('job.queued', { id: job.id, kind, user: userId, depth: queue.length });
  pump();
  return publicJob(job);
}

export function publicJob(job) {
  if (!job) return null;
  const { fn, ...rest } = job;
  void fn;
  return rest;
}

export function getJob(userId, id) {
  const job = jobs.get(id);
  return job && job.userId === userId ? publicJob(job) : null;
}

export function listJobs(userId) {
  return [...jobs.values()].filter((j) => j.userId === userId).map(publicJob);
}

export function queueStats() {
  return { running, queued: queue.length, maxConcurrent: MAX_CONCURRENT, tracked: jobs.size };
}

export function deleteUserJobs(userId) {
  let n = 0;
  for (const [id, j] of jobs) {
    if (j.userId === userId) {
      jobs.delete(id);
      n += 1;
    }
  }
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].userId === userId) queue.splice(i, 1);
  }
  return n;
}
