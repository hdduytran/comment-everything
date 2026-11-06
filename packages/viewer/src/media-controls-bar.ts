import { formatTimecode } from '@comment-everything/core/browser';
import type { MediaAction } from './media-keyboard-shortcuts.js';

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

export interface ControlsBar {
  element: HTMLElement;
  setTime(current: number, duration: number): void;
  setPlaying(playing: boolean): void;
  setLoop(on: boolean): void;
  setStatus(text: string): void;
  /** Enable the optional scene-cut button (video with ffmpeg available). */
  enableScenes(on: boolean): void;
}

export interface ControlsHandlers {
  action(a: MediaAction): void;
  speed(rate: number): void;
  scenes(): void;
}

/** Transport + range controls. Every button mirrors a keyboard shortcut. */
export function createControlsBar(h: ControlsHandlers): ControlsBar {
  const element = document.createElement('div');
  element.className = 'ce-media-controls';
  element.dataset.ce = 'media-controls';

  const button = (label: string, title: string, id: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.dataset.ce = id;
    b.addEventListener('click', onClick);
    return b;
  };
  const act = (a: MediaAction) => () => h.action(a);

  const play = button('Play', 'Play / pause (space)', 'media-play', act({ type: 'toggle-play' }));
  const time = document.createElement('span');
  time.className = 'ce-media-time';
  time.dataset.ce = 'media-time';
  const loop = button(
    'Loop range',
    'Loop the selected range (l)',
    'media-loop',
    act({ type: 'toggle-loop' }),
  );
  const scenes = button('Scene cuts', 'Suggest scene boundaries', 'media-scenes', h.scenes);
  scenes.hidden = true;
  const status = document.createElement('span');
  status.className = 'ce-media-status';
  status.dataset.ce = 'media-status';
  status.setAttribute('role', 'status');

  const speed = document.createElement('select');
  speed.title = 'Playback speed';
  speed.dataset.ce = 'media-speed';
  for (const s of SPEEDS) speed.append(new Option(`${s}x`, String(s), false, s === 1));
  speed.addEventListener('change', () => h.speed(Number(speed.value)));

  element.append(
    play,
    button(
      '⏮',
      'Back one frame (,)',
      'media-step-back',
      act({ type: 'step-frame', direction: -1 }),
    ),
    button(
      '⏭',
      'Forward one frame (.)',
      'media-step-forward',
      act({ type: 'step-frame', direction: 1 }),
    ),
    time,
    speed,
    button('[ In', 'Mark in-point at the playhead ([)', 'media-in', act({ type: 'mark-in' })),
    button('] Out', 'Mark out-point and add the range (])', 'media-out', act({ type: 'mark-out' })),
    button('Point', 'Comment on the playhead time (p)', 'media-point', act({ type: 'point' })),
    loop,
    scenes,
    status,
  );

  return {
    element,
    setTime(current, duration) {
      time.textContent = `${formatTimecode(current)} / ${formatTimecode(duration)}`;
    },
    setPlaying(playing) {
      play.textContent = playing ? 'Pause' : 'Play';
    },
    setLoop(on) {
      loop.classList.toggle('active', on);
    },
    setStatus(text) {
      status.textContent = text;
    },
    enableScenes(on) {
      scenes.hidden = !on;
    },
  };
}
