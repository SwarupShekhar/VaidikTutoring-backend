const { Queue } = require('bullmq');
const Redis = require('ioredis');

async function checkJobs() {
  const connection = new Redis();
  const queue = new Queue('email-queue', { connection });
  
  const waiting = await queue.getWaiting();
  const active = await queue.getActive();
  const completed = await queue.getCompleted();
  
  console.log(`Waiting jobs: ${waiting.length}`);
  console.log(`Active jobs: ${active.length}`);
  console.log(`Completed jobs: ${completed.length}`);
  
  process.exit(0);
}

checkJobs().catch(console.error);
