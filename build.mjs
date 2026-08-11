import { execSync } from 'child_process';
import { existsSync } from 'fs';

console.log('Building api-server...');
try {
  execSync('pnpm --filter @project-fixer/api-server build', { stdio: 'inherit' });
  console.log('Build done!');
} catch (e) {
  console.log('Build failed, trying alternative...');
  try {
    execSync('cd artifacts/api-server && pnpm build', { stdio: 'inherit' });
  } catch (e2) {
    console.error('Build error', e2.message);
  }
}

console.log('Checking dist...');
if (existsSync('artifacts/api-server/dist')) {
  console.log('dist exists!');
  execSync('ls -la artifacts/api-server/dist', { stdio: 'inherit' });
} else {
  console.log('No dist folder found!');
}