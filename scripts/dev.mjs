// 서버(8787)와 화면 개발 서버(5173)를 함께 띄운다
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const procs = [
  spawn(npm, ['run', 'dev', '-w', 'server'], { stdio: 'inherit' }),
  spawn(npm, ['run', 'dev', '-w', 'client'], { stdio: 'inherit' }),
];
const stop = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && stop());
