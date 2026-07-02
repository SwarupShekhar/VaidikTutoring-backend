require('dotenv').config();
const { Queue } = require('bullmq');
const Redis = require('ioredis');

async function checkJobs() {
  const connection = new Redis(process.env.REDIS_URL);
  const queue = new Queue('email-queue', { connection });
  
  const waiting = await queue.getWaiting();
  const active = await queue.getActive();
  const completed = await queue.getCompleted();
  const failed = await queue.getFailed();
  const delayed = await queue.getDelayed();
  
  console.log(`Waiting jobs: ${waiting.length}`);
  console.log(`Active jobs: ${active.length}`);
  console.log(`Completed jobs: ${completed.length}`);
  console.log(`Failed jobs: ${failed.length}`);
  console.log(`Delayed jobs: ${delayed.length}`);
  
  process.exit(0);
}

checkJobs().catch(console.error);
