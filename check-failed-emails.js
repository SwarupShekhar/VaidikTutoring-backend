require('dotenv').config();
const { Queue } = require('bullmq');
const Redis = require('ioredis');

async function checkFailedJobs() {
  const connection = new Redis(process.env.REDIS_URL);
  const queue = new Queue('email-queue', { connection });
  
  const failed = await queue.getFailed();
  
  for (const job of failed) {
    console.log(`Job ${job.id} failed with reason:`, job.failedReason);
  }
  
  process.exit(0);
}

checkFailedJobs().catch(console.error);
