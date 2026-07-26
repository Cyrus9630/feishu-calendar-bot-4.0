import { spawn } from 'node:child_process';

import { conciseError, redactSecrets } from './core.mjs';

export function runCommand(command, args = [], options = {}) {
  const {
    cwd,
    stdin = '',
    secrets = [],
    env = process.env,
    allowFailure = false,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => reject(new Error(conciseError(error, secrets))));
    child.on('close', (code) => {
      const result = {
        code: code ?? 1,
        stdout: redactSecrets(stdout, secrets),
        stderr: redactSecrets(stderr, secrets),
      };
      if (result.code === 0 || allowFailure) return resolve(result);
      const detail = conciseError(result.stderr || result.stdout || `${command} 执行失败`, secrets);
      reject(new Error(detail));
    });
    if (stdin) child.stdin.write(stdin);
    child.stdin.end();
  });
}

export async function commandAvailable(command, runner = runCommand) {
  try {
    const result = await runner(command, ['--version'], { allowFailure: true });
    return result.code === 0;
  } catch {
    return false;
  }
}
