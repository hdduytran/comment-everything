import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import path from 'node:path';

export const FFMPEG_INSTALL_HINT =
  'ffmpeg was not found on PATH. Install it (macOS: `brew install ffmpeg`, Debian/Ubuntu: `sudo apt install ffmpeg`, Windows: `winget install ffmpeg`) to get keyframes and thumbnails. Comments are still saved.';

export const WHISPER_INSTALL_HINT =
  'whisper.cpp (`whisper-cli`) was not found; transcripts are skipped. Install whisper.cpp and set WHISPER_MODEL to a ggml model file to enable them.';

/** Locate an executable on PATH (no process spawn). Returns null when absent. */
export function findBinary(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const exts = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

export interface MediaTools {
  ffmpeg: string | null;
  ffprobe: string | null;
  /** Path of `whisper-cli`, or null. */
  whisper: string | null;
  /** ggml model file for whisper, or null. */
  whisperModel: string | null;
}

/** Resolve the external tools; `WHISPER_CLI` / `WHISPER_MODEL` override discovery. */
export function detectMediaTools(env: NodeJS.ProcessEnv = process.env): MediaTools {
  return {
    ffmpeg: findBinary('ffmpeg', env),
    ffprobe: findBinary('ffprobe', env),
    whisper: env.WHISPER_CLI || findBinary('whisper-cli', env),
    whisperModel: env.WHISPER_MODEL || null,
  };
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

/** Run a binary with an argument array (never a shell); rejects on non-zero exit or timeout. */
export function runBinary(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number; maxBuffer?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: opts.timeoutMs ?? 120_000, maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const tail = String(stderr).trim().split('\n').slice(-3).join(' | ');
          reject(new Error(`${path.basename(bin)} failed: ${err.message.split('\n')[0]} ${tail}`));
        } else {
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        }
      },
    );
  });
}
