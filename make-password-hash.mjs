import { pbkdf2Sync, randomBytes } from 'node:crypto';

const ITERATIONS = 100_000;
const KEY_LENGTH = 32;

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      reject(new Error('Jalankan perintah ini dari terminal interaktif agar kata sandi tidak tampil di layar.'));
      return;
    }
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();
    let value = '';
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\u0003') {
          input.setRawMode(false);
          input.pause();
          input.off('data', onData);
          process.stdout.write('\n');
          reject(new Error('Dibatalkan.'));
          return;
        }
        if (char === '\r' || char === '\n') {
          input.setRawMode(false);
          input.pause();
          input.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    input.on('data', onData);
  });
}

try {
  const password = await readHidden('Kata sandi administrator (minimum 16 karakter): ');
  const confirmation = await readHidden('Ulangi kata sandi: ');
  if (password.length < 16) throw new Error('Kata sandi harus memiliki sedikitnya 16 karakter.');
  if (password !== confirmation) throw new Error('Kata sandi tidak cocok.');
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256');
  const saltText = salt.toString('base64url');
  const hashText = derived.toString('base64url');
  console.log(`ADMIN_PASSWORD_HASH=pbkdf2_sha256$${ITERATIONS}$${saltText}$${hashText}`);
  console.log('Salin baris hash ini ke .dev.vars, atau masukkan nilainya ke Wrangler Secret saat deployment. Jangan commit file yang memuat hash/password.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
