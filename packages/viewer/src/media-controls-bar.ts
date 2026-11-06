import { formatTimecode } from '@comment-everything/core/browser';
import { icon, type IconName } from '@comment-everything/overlay';
import type { MediaAction } from './media-keyboard-shortcuts.js';
import { viewerTooltips } from './viewer-tooltips.js';

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

interface ButtonSpec {
  id: string;
  /** Visible text; omitted for icon-only buttons (then `label` names it). */
  text?: string;
  label: string;
  icon: IconName;
  tip: string;
  shortcut?: string;
  onClick: () => void;
}

/** Transport + range controls. Every button mirrors a keyboard shortcut and explains itself. */
export function createControlsBar(h: ControlsHandlers): ControlsBar {
  const tips = viewerTooltips();
  const element = document.createElement('div');
  element.className = 'ce-media-controls';
  element.dataset.ce = 'media-controls';
  element.setAttribute('role', 'toolbar');
  element.setAttribute('aria-label', 'Playback and range controls');

  const button = (s: ButtonSpec) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.ce = s.id;
    b.setAttribute('aria-label', s.label);
    b.append(icon(document, s.icon));
    if (s.text) b.append(Object.assign(document.createElement('span'), { textContent: s.text }));
    else b.classList.add('icon-only');
    b.addEventListener('click', s.onClick);
    tips.attach(b, { text: s.tip, shortcut: s.shortcut });
    return b;
  };
  const group = (...nodes: HTMLElement[]) => {
    const g = document.createElement('div');
    g.className = 'group';
    g.append(...nodes);
    return g;
  };
  const act = (a: MediaAction) => () => h.action(a);

  const play = button({
    id: 'media-play',
    text: 'Play',
    label: 'Play',
    icon: 'play',
    tip: 'Play or pause the media.',
    shortcut: 'Space',
    onClick: act({ type: 'toggle-play' }),
  });
  const loop = button({
    id: 'media-loop',
    text: 'Loop range',
    label: 'Loop range',
    icon: 'loop',
    tip: 'Repeat the selected range until you turn this off.',
    shortcut: 'L',
    onClick: act({ type: 'toggle-loop' }),
  });
  const scenes = button({
    id: 'media-scenes',
    text: 'Scene cuts',
    label: 'Scene cuts',
    icon: 'scenes',
    tip: 'Suggest range boundaries at scene changes in the video.',
    onClick: h.scenes,
  });
  scenes.hidden = true;

  const time = document.createElement('span');
  time.className = 'ce-media-time';
  time.dataset.ce = 'media-time';
  const status = document.createElement('span');
  status.className = 'ce-media-status';
  status.dataset.ce = 'media-status';
  status.setAttribute('role', 'status');

  const speed = document.createElement('select');
  speed.setAttribute('aria-label', 'Playback speed');
  speed.dataset.ce = 'media-speed';
  for (const s of SPEEDS) speed.append(new Option(`${s}x`, String(s), false, s === 1));
  speed.addEventListener('change', () => h.speed(Number(speed.value)));
  tips.attach(speed, { text: 'Playback speed. Comments keep their exact times.' });

  element.append(
    group(
      button({
        id: 'media-step-back',
        label: 'Back one frame',
        icon: 'stepBack',
        tip: 'Step back one frame.',
        shortcut: ',',
        onClick: act({ type: 'step-frame', direction: -1 }),
      }),
      play,
      button({
        id: 'media-step-forward',
        label: 'Forward one frame',
        icon: 'stepForward',
        tip: 'Step forward one frame.',
        shortcut: '.',
        onClick: act({ type: 'step-frame', direction: 1 }),
      }),
      time,
      speed,
    ),
    group(
      button({
        id: 'media-in',
        text: 'In',
        label: 'Mark in-point',
        icon: 'markIn',
        tip: 'Start a comment range at the playhead.',
        shortcut: '[',
        onClick: act({ type: 'mark-in' }),
      }),
      button({
        id: 'media-out',
        text: 'Out',
        label: 'Mark out-point',
        icon: 'markOut',
        tip: 'End the range at the playhead and add it as a pending comment.',
        shortcut: ']',
        onClick: act({ type: 'mark-out' }),
      }),
      button({
        id: 'media-point',
        text: 'Point',
        label: 'Comment on this moment',
        icon: 'point',
        tip: 'Comment on the exact moment under the playhead.',
        shortcut: 'P',
        onClick: act({ type: 'point' }),
      }),
      loop,
      scenes,
    ),
    status,
  );

  const setPlayIcon = (name: 'play' | 'pause') => {
    play.querySelector('svg')?.replaceWith(icon(document, name));
  };

  return {
    element,
    setTime(current, duration) {
      time.textContent = `${formatTimecode(current)} / ${formatTimecode(duration)}`;
    },
    setPlaying(playing) {
      const label = playing ? 'Pause' : 'Play';
      play.querySelector('span')!.textContent = label;
      play.setAttribute('aria-label', label);
      setPlayIcon(playing ? 'pause' : 'play');
    },
    setLoop(on) {
      loop.classList.toggle('active', on);
      loop.setAttribute('aria-pressed', String(on));
    },
    setStatus(text) {
      status.textContent = text;
    },
    enableScenes(on) {
      scenes.hidden = !on;
    },
  };
}
