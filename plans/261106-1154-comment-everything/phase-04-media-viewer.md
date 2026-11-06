# Phase 4 — Media viewer: video/audio ranges, keyframes, transcript

## Requirements
- Media viewer in `viewer`: `<video>`/`<audio>` + wavesurfer.js with regions plugin.
  - Create range by drag on waveform/timeline or keys `[` / `]` (in/out at playhead); point comment = zero-length range.
  - Frame-step keys (`,` `.`), playback speed, loop selected range.
  - Thumbnail strip for video (ffmpeg sprite) to pick scenes visually.
  - Optional scene-cut detection (`ffmpeg select='gt(scene,0.3)'`) to suggest scene boundaries.
- On Send, daemon jobs per comment:
  - Video: extract 3 keyframes (start, middle, end) → `.comments/assets/<id>-<t>.jpg`.
  - Optional short clip export (`-c copy`) for agents that accept video.
  - Transcript: whisper.cpp if installed (detected), cached per file; attach segment text overlapping the range.
- Selector: `FragmentSelector` `t=12.400,15.000` + source path; prompt shows `promo.mp4 @ 00:12.400–00:15.000`.
- Graceful degradation: no ffmpeg → comments still saved, warning shown with install hint.

## Files
`packages/viewer/src/{media-viewer,waveform-range-selector,video-thumbnail-strip,media-keyboard-shortcuts}.ts`, `packages/daemon/src/{ffmpeg-keyframe-extractor,scene-cut-detector,whisper-transcriber,media-job-queue}.ts`.

## Validation
- Fixture video with burned-in timecode: keyframe at t matches timecode (±0.1 s).
- e2e: create 2 ranges, Send → assets exist, `get_comment` returns images.
