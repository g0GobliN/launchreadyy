import { describe, expect, it, afterEach } from "vitest";
import {
  enqueueBackgroundJob,
  setJobRunner,
  getJobRunner,
  resetJobRunner,
  createInlineJobRunner,
  startJobWorker,
  stopJobWorker,
  drainDurableJobs,
} from "./jobs.server";

afterEach(() => {
  resetJobRunner();
});

describe("enqueueBackgroundJob", () => {
  it("delegates to the active JobRunner", async () => {
    const inline = createInlineJobRunner();
    setJobRunner(inline);
    let ran = false;
    enqueueBackgroundJob(async () => {
      ran = true;
    });
    await inline.drain();
    expect(ran).toBe(true);
  });

  it("getJobRunner returns the runner set via setJobRunner", () => {
    const inline = createInlineJobRunner();
    setJobRunner(inline);
    expect(getJobRunner()).toBe(inline);
  });
});

describe("local job worker", () => {
  it("startJobWorker is idempotent and stopJobWorker clears it", () => {
    stopJobWorker();
    startJobWorker();
    startJobWorker(); // second call must not throw or double-register
    stopJobWorker();
  });

  it("drainDurableJobs completes against an empty queue", async () => {
    await expect(drainDurableJobs(1)).resolves.toBeUndefined();
  });
});
