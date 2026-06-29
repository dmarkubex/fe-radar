# FE-Radar Product Showcase Render Notes

## Acceptance Criteria

- Create a 1920x1080 product showcase MP4 for FE-Radar.
- Use the Presenton reference only at style level: dark spatial stage, large kinetic type, prompt card, gradient CTA, UI cards, source/capability rings, export burst, final claim.
- Use actual FE-Radar project assets where available.
- Keep frame 0 usable as a preview cover.
- Verify media specs, representative stills, and reference/candidate style evidence.

## Output

- Final MP4: `/Volumes/SD/AI-Timeline-web/output/product-showcase/fe-radar-showcase/fe-radar-product-showcase.mp4`
- Render script: `/Volumes/SD/AI-Timeline-web/output/product-showcase/fe-radar-showcase/render_showcase.py`
- First frame: `/Volumes/SD/AI-Timeline-web/output/product-showcase/fe-radar-showcase/qc/first-frame.jpg`
- Candidate contact sheet: `/Volumes/SD/AI-Timeline-web/output/product-showcase/fe-radar-showcase/qc/contact-sheet.jpg`
- Half-second QC sheets:
  - `/Volumes/SD/AI-Timeline-web/output/product-showcase/fe-radar-showcase/qc/halfsec/contact/contact_01.jpg`
  - `/Volumes/SD/AI-Timeline-web/output/product-showcase/fe-radar-showcase/qc/halfsec/contact/contact_02.jpg`
  - `/Volumes/SD/AI-Timeline-web/output/product-showcase/fe-radar-showcase/qc/halfsec/contact/contact_03.jpg`
- Style side-by-side sheet: `/Volumes/SD/AI-Timeline-web/output/product-showcase/fe-radar-showcase/qc/style-side-by-side.jpg`
- Reference comparison report: `/Volumes/SD/AI-Timeline-web/output/product-showcase/fe-radar-showcase/qc/reference-compare/comparison-report.md`

## Media Specs

`ffprobe` result:

- Duration: 35.000s
- Video: H.264, 1920x1080, 30fps
- Audio: AAC, 48kHz, stereo, silent compatibility track
- File size: 2,833,623 bytes

## Verification Commands

```bash
ffprobe -v error \
  -show_entries format=duration,size,bit_rate:stream=index,codec_type,codec_name,width,height,r_frame_rate,channels,sample_rate \
  -of json /Volumes/SD/AI-Timeline-web/output/product-showcase/fe-radar-showcase/fe-radar-product-showcase.mp4

python3 /Users/diaomin/.codex/skills/reference-video-replica-qc/scripts/extract_halfsec_frames.py \
  /Volumes/SD/AI-Timeline-web/output/product-showcase/fe-radar-showcase/fe-radar-product-showcase.mp4 \
  --out /Volumes/SD/AI-Timeline-web/output/product-showcase/fe-radar-showcase/qc/halfsec \
  --contact --cols 4

python3 /Users/diaomin/.codex/skills/reference-video-replica-qc/scripts/compare_videos.py \
  /Volumes/SD/AI-Timeline-web/output/product-showcase/reference-qc/reference.mp4 \
  /Volumes/SD/AI-Timeline-web/output/product-showcase/fe-radar-showcase/fe-radar-product-showcase.mp4 \
  --out /Volumes/SD/AI-Timeline-web/output/product-showcase/fe-radar-showcase/qc/reference-compare \
  --skip-metrics

ffmpeg -hide_banner -nostats \
  -i /Volumes/SD/AI-Timeline-web/output/product-showcase/fe-radar-showcase/fe-radar-product-showcase.mp4 \
  -af volumedetect -f null -
```

## Verification Result

- First frame is visible and usable as a preview cover.
- Sample/contact sheets show no blank frames, no local filesystem paths, and no obvious text overlap.
- Reference/candidate comparison: `Byte-identical cmp: False`, as expected for style-level work.
- Audio volume: mean `-91.0 dB`, max `-91.0 dB`; this is a silent AAC compatibility track, not BGM.

## Notes

- No FE-Radar application source files were changed.
- Product screenshots came from the existing `design/*.png` assets and `apps/web/public/fareast-logo.png`.
- The installed half-second extraction script has an edge case on exact 35.000s media where it tries to include a non-existent `35.0s` still. Frames through `34.5s` were extracted, and the final half-second contact page was rebuilt from the existing extracted frames.
- Raw frame caches were removed after encoding; rerun `render_showcase.py` to regenerate them.
