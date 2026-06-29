# Reference Alignment Report

## Scope

- Requested reference: GitHub `private-user-images` MP4 URL.
- Direct URL status: expired/private URL returned HTTP 404.
- Resolved source: installed `reference-video-replica-qc` canonical asset, matching the same GitHub attachment UUID in the Pluviobyte repo docs.
- Local reference: `/Volumes/SD/AI-Timeline-web/output/product-showcase/reference-qc/reference.mp4`
- Fidelity level: style-level. This is a product showcase inspired by the reference, not a frame-accurate remake.

## Reference Media

- Duration: 35.136s
- Resolution: 1920x1080
- Frame rate: 30fps
- Streams: H.264 video + AAC audio

## Extraction

```bash
python3 /Users/diaomin/.codex/skills/reference-video-replica-qc/scripts/extract_halfsec_frames.py \
  /Volumes/SD/AI-Timeline-web/output/product-showcase/reference-qc/reference.mp4 \
  --out /Volumes/SD/AI-Timeline-web/output/product-showcase/reference-qc/frames \
  --contact --cols 4
```

Contact sheets:

- `/Volumes/SD/AI-Timeline-web/output/product-showcase/reference-qc/frames/contact/contact_01.jpg`
- `/Volumes/SD/AI-Timeline-web/output/product-showcase/reference-qc/frames/contact/contact_02.jpg`
- `/Volumes/SD/AI-Timeline-web/output/product-showcase/reference-qc/frames/contact/contact_03.jpg`

## Timeline Notes

| Time       | Reference state                                                                       | Style rule carried forward                                                           |
| ---------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 0.0-5.5s   | Black grain stage, weak purple horizon, kinetic white promise text, logo lockup.      | Start on dark spatial stage with large white type and restrained brand lockup.       |
| 5.5-9.5s   | Fast white velocity wipe into tilted prompt card; cyan-magenta CTA gets cursor click. | Use a large prompt/invocation card and one visible gradient action button.           |
| 9.5-14.5s  | Template/result cards fly into a grouped result field.                                | Summon multiple product UI cards, then resolve them into one readable product frame. |
| 14.5-17.0s | Large app window rises; platform pills appear above it.                               | Use one big app window, not a tiny remote screenshot.                                |
| 17.0-20.5s | Provider node enters with integration pills around it.                                | Map to FE-Radar selected-source network.                                             |
| 20.5-24.5s | Model/capability ring rotates around a central claim.                                 | Map to FE-Radar pipeline capabilities.                                               |
| 24.5-30.5s | Export CTA triggers folder and output pills.                                          | Map to timeline, alerts, digest, DOCX, DingTalk, dashboard outputs.                  |
| 30.5-35.0s | Final large text claim holds on the dark stage.                                       | End with a memorable product-category claim.                                         |

## Decision

The reference is suitable for a style-level FE-Radar showcase. Pixel-level or visual-level approval is not applicable because the candidate intentionally changes product, text, UI assets, and final claim.
