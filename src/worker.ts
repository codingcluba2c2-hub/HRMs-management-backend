import { Worker } from 'bullmq';
import { prisma } from './lib/prisma';
import redis from './lib/redis';

console.log('🚀 Starting Background Worker Process...');

const connection = redis; // Use our existing robust Redis connection

const emailQueueWorker = new Worker('emailQueue', async job => {
  console.log(`Processing email job: ${job.id} for ${job.data.email}`);
  // Simulate heavy email sending
  await new Promise(res => setTimeout(res, 2000));
  console.log(`✅ Email sent to ${job.data.email}`);
}, { connection: redis as any });

const bulkImportWorker = new Worker('bulkImportQueue', async job => {
  console.log(`Processing bulk import job: ${job.id}`);
  const { employees, hrAdminId } = job.data;
  
  // Here we would call the EmployeeService.bulkCreateEmployee logic
  // For safety in this detached worker, we just simulate the time it takes.
  console.log(`Importing ${employees.length} employees...`);
  await new Promise(res => setTimeout(res, Math.max(employees.length * 100, 2000)));
  console.log(`✅ Bulk import completed for job ${job.id}`);
}, { connection: redis as any });

emailQueueWorker.on('failed', (job, err) => {
  console.error(`${job?.id} has failed with ${err.message}`);
});

bulkImportWorker.on('failed', (job, err) => {
  console.error(`${job?.id} has failed with ${err.message}`);
});

console.log('✅ Workers are listening to queues.');

// Graceful Shutdown
process.on('SIGTERM', async () => {
  console.log('Gracefully shutting down workers...');
  await emailQueueWorker.close();
  await bulkImportWorker.close();
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
});
