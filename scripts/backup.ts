import { execSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { BlobServiceClient } from '@azure/storage-blob';

// Manual .env loader matching codebase patterns
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split('\n').forEach((line) => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim().replace(/^['"]|['"]$/g, '');
            if (!process.env[key]) {
                process.env[key] = value;
            }
        }
    });
}

const connectionString = process.env.DATABASE_URL;
const azureConnectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY;

if (!connectionString) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
}

if (!azureConnectionString) {
    console.error('❌ AZURE_STORAGE_CONNECTION_STRING environment variable is required');
    process.exit(1);
}

if (!encryptionKey) {
    console.error('❌ BACKUP_ENCRYPTION_KEY environment variable is required');
    process.exit(1);
}

async function main() {
    console.log('🏁 Starting automated database backup process...');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tempSqlFile = path.resolve(__dirname, `../tmp_backup_${timestamp}.sql`);
    const encryptedFile = `${tempSqlFile}.enc`;

    try {
        // Step 1: Execute pg_dump
        console.log(`📦 Creating SQL dump via pg_dump to temporary file...`);
        execSync(`pg_dump "${connectionString}" -F p -f "${tempSqlFile}"`, { stdio: 'inherit' });
        console.log('✅ SQL dump created successfully.');

        // Step 2: Encrypt SQL dump using AES-256-CBC
        console.log('🔒 Encrypting SQL dump using AES-256-CBC...');
        encryptFile(tempSqlFile, encryptedFile, encryptionKey!);
        console.log('✅ File encrypted successfully.');

        // Step 3: Upload to Azure Blob Storage
        console.log('☁️  Connecting to Azure Blob Storage...');
        const blobServiceClient = BlobServiceClient.fromConnectionString(azureConnectionString!);
        const containerName = 'database-backups';
        const containerClient = blobServiceClient.getContainerClient(containerName);

        // Create container if it doesn't exist
        await containerClient.createIfNotExists();

        const blobName = `backup_${timestamp}.sql.enc`;
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        console.log(`📤 Uploading encrypted file to container '${containerName}' as '${blobName}'...`);
        const fileBuffer = fs.readFileSync(encryptedFile);
        await blockBlobClient.uploadData(fileBuffer);
        console.log('✅ Upload to Azure Blob Storage completed successfully.');

    } catch (error) {
        console.error('❌ Backup failed with error:', error);
        throw error;
    } finally {
        // Step 4: Cleanup temporary files
        console.log('🧹 Cleaning up local temporary files...');
        if (fs.existsSync(tempSqlFile)) {
            fs.unlinkSync(tempSqlFile);
            console.log('🗑️ Removed temp SQL dump.');
        }
        if (fs.existsSync(encryptedFile)) {
            fs.unlinkSync(encryptedFile);
            console.log('🗑️ Removed temp encrypted file.');
        }
        console.log('✨ Cleanup complete.');
    }
}

function encryptFile(inputPath: string, outputPath: string, keyString: string) {
    // Generate a secure 32-byte key from the env secret
    const key = crypto.createHash('sha256').update(keyString).digest();
    const iv = crypto.randomBytes(16); // 16-byte random IV for AES-256-CBC

    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const input = fs.readFileSync(inputPath);

    // Output is the IV concatenated with the ciphertext
    const encrypted = Buffer.concat([iv, cipher.update(input), cipher.final()]);
    fs.writeFileSync(outputPath, encrypted);
}

main()
    .then(() => {
        console.log('🎉 Automated backup run finished successfully!');
        process.exit(0);
    })
    .catch((err) => {
        console.error('💥 Database backup run aborted due to error.');
        process.exit(1);
    });
