import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

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

const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY;

if (!encryptionKey) {
    console.error('❌ BACKUP_ENCRYPTION_KEY environment variable is required in .env');
    process.exit(1);
}

const encryptedFilePath = process.argv[2];
if (!encryptedFilePath) {
    console.log('\n📖 Usage:');
    console.log('   npx ts-node scripts/decrypt-backup.ts <path-to-encrypted-file> [optional-output-path]\n');
    console.error('❌ Error: Please provide the path to the encrypted file.');
    process.exit(1);
}

const resolvedInputPath = path.resolve(encryptedFilePath);
if (!fs.existsSync(resolvedInputPath)) {
    console.error(`❌ Error: File not found at '${resolvedInputPath}'`);
    process.exit(1);
}

const outputFilePath = process.argv[3] || resolvedInputPath.replace(/\.enc$/, '').replace(/\.sql$/, '') + '_decrypted.sql';
const resolvedOutputPath = path.resolve(outputFilePath);

try {
    console.log(`🔓 Decrypting '${resolvedInputPath}'...`);
    decryptFile(resolvedInputPath, resolvedOutputPath, encryptionKey);
    console.log(`✅ Decryption complete! Decrypted file saved to:\n👉 ${resolvedOutputPath}`);
} catch (error) {
    console.error('❌ Decryption failed. Make sure your BACKUP_ENCRYPTION_KEY is correct.');
    console.error(error);
    process.exit(1);
}

function decryptFile(inputPath: string, outputPath: string, keyString: string) {
    const key = crypto.createHash('sha256').update(keyString).digest();
    const data = fs.readFileSync(inputPath);

    // Extract the IV from the first 16 bytes
    const iv = data.slice(0, 16);
    const encryptedData = data.slice(16);

    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    fs.writeFileSync(outputPath, decrypted);
}
