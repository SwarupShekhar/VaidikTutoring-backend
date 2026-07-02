const { Queue } = require('bullmq');
const Redis = require('ioredis');

async function retryFailedJobs() {
  const connection = new Redis();
  const queue = new Queue('email-queue', { connection });
  
  const failedJobs = await queue.getFailed();
  console.log(`Found ${failedJobs.length} failed email jobs.`);
  
  for (const job of failedJobs) {
    console.log(`Retrying job ${job.id}...`);
    await job.retry();
  }
  
  console.log('All failed jobs have been queued for retry!');
  process.exit(0);
}

retryFailedJobs().catch(console.error);
