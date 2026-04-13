# Demo Video Recording Guide

This directory contains the automated recording system for the AI Investigator demo video. The video is composed of 5 scenes, each recorded independently as `.webm` files, then combined with a voiceover audio track into a final `.mp4`.

## Prerequisites

- **Node.js** (v18+)
- **Playwright** browsers installed: `cd scripts/screenshots && npx playwright install chromium`
- **ffmpeg** (for combining scenes + audio into the final MP4)

## Architecture

```
scripts/screenshots/
├── preview-scene1.js          # Title card + case study (self-contained)
├── preview-scene2.js          # Dashboard → create investigation
├── preview-scene3.js          # Pipeline walkthrough (6-agent live simulation)
├── preview-scene4.js          # Final report, contest, implement, notes
├── preview-scene5.js          # Retrospect — knowledge improvement
├── scenes/
│   ├── scene-create-investigation.js
│   ├── scene-pipeline-walkthrough.js
│   ├── scene-final-report.js
│   └── scene-retrospect.js
├── lib/
│   ├── helpers.js             # pause(), fixtures, mock control
│   ├── overlay.js             # captions, cursor, highlights, keepalive
│   └── cards.js               # title card, case study card
├── mock-server.js             # Express mock API (port 3099)
└── fixtures/                  # JSON state files for each scene
```

Each `preview-sceneN.js` is a standalone recorder that:
1. Starts the mock API server (port 3099)
2. Starts Vite dev server (port 5174)
3. Warms up Vite (pre-loads pages so no cold-start lag)
4. Launches Playwright with video recording
5. Runs the scene script with captions and cursor animations
6. Saves to `docs/demo/preview-sceneN.webm`

## Recording Individual Scenes

```bash
cd scripts/screenshots

# Headless (fastest)
node preview-scene1.js
node preview-scene2.js
node preview-scene3.js
node preview-scene4.js
node preview-scene5.js

# Headed (watch in real-time)
node preview-scene1.js --headed
```

Each scene outputs a `.webm` file in `docs/demo/`.

## Scene Descriptions

| Scene | File | Duration | Content |
|-------|------|----------|---------|
| 1 | `preview-scene1.js` | ~34s | Title card, case study (latency chart), transition card |
| 2 | `preview-scene2.js` | ~98s | Dashboard overview, create new investigation form |
| 3 | `preview-scene3.js` | ~116s | Pipeline walkthrough — 6 agents, rejection loops, live state transitions |
| 4 | `preview-scene4.js` | ~93s | Final report, contest report, implement recommendations, notes |
| 5 | `preview-scene5.js` | ~98s | Retrospect tab, re-run analysis, approve & apply proposals |

## Caption Timing (SRT Sync)

Scene 4 uses precise timing instrumentation to sync captions with a voiceover narration track. The `_logT()` calls in `scene-final-report.js` print timing data during recording:

```
TIMING caption 1 "Final Report" at 0ms (target: 0ms, diff: 0ms)
TIMING caption 2 "Root Cause Analysis" at 6916ms (target: 6960ms, diff: -44ms)
...
```

If you re-record the voiceover, update the `_SRT` array in `scene-final-report.js` with the new subtitle timestamps (milliseconds from scene start).

## Combining into Final Video

After recording all 5 scenes, combine them with the voiceover audio using ffmpeg:

```bash
# 1. Concatenate the 5 webm files
ffmpeg -i docs/demo/preview-scene1.webm \
       -i docs/demo/preview-scene2.webm \
       -i docs/demo/preview-scene3.webm \
       -i docs/demo/preview-scene4.webm \
       -i docs/demo/preview-scene5.webm \
       -filter_complex "[0:v][1:v][2:v][3:v][4:v]concat=n=5:v=1:a=0[v]" \
       -map "[v]" -c:v libx264 -preset slow -crf 22 \
       docs/demo/combined-video.mp4

# 2. Add the voiceover audio track
ffmpeg -i docs/demo/combined-video.mp4 \
       -i "docs/demo/AI Investigator.mp3" \
       -c:v copy -c:a aac -b:a 192k -shortest \
       "docs/demo/AI Investigator.mp4"
```

> **Note:** The audio file is not checked into the repository. Create it separately using TTS (e.g., ElevenLabs) from the narration text files, then combine with the video.

## Output Files (not committed)

The following files are generated and listed in `.gitignore`:
- `docs/demo/*.webm` — individual scene recordings
- `docs/demo/*.mp4` — final combined video

## Troubleshooting

- **Port conflicts**: Kill any existing node processes before recording: `Get-Process -Name node | Stop-Process -Force`
- **White flash on navigation**: The anti-flash CSS injection in each preview script prevents this. If you see flashes, ensure the `page.route()` interceptor is active.
- **Video too short / frames missing**: The keepalive element in `overlay.js` forces continuous compositor updates. If pauses seem too short, check that `#demo-keepalive` is injected.
- **Caption timing drift**: Run with timing instrumentation, compare actual vs target, and adjust `pause()` values. See the "Caption Timing" section above.
