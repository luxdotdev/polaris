---
status: accepted
fixes: Host, Workspace and web images could make the renderer allocate far more than their header-sized cost
---

# Preview images are measured before decoding

## Context

The renderer decodes images whose bytes come from a Host, a Workspace or the web: Markdown
previews, images a tool read in an Agent Session, sent attachments. Chromium sniffs the
format from the bytes and decodes whatever it finds, so a small file can ask for gigabytes.
`shared/raster` reads each format's headers and estimates what Chromium will allocate, and
`admitRaster` refuses an image over the preview caps before any decode.

Sources below are Chromium `main` at `3ab520d5` (2026-10-15).

## Decision

- **Sniffing mirrors Blink.** `SniffMimeTypeInternal` (`image_decoder.cc`) tries JPEG, PNG,
  GIF, WebP (`RIFF????WEBPVP`), ICO/CUR (`00 00 01 00`, `00 00 02 00`), BMP (`BM`, `BA`),
  then AVIF. `sniff` checks the same signatures in the same order, and refuses the formats
  it doesn't measure. An AVIF whose `ftyp` box is 256 bytes long is an ICO to Blink.
- **Every animation frame costs a whole canvas.** `ImageDecoder::InitFrameBuffer` and
  `SkiaImageDecoderBase::Decode` allocate each frame at `Size()`, the canvas, however small
  its rectangle. Frames a requested frame depends on are decoded and kept in
  `frame_buffer_cache_` until the decode returns; only then does `ImageDecoderWrapper::Decode`
  call `ClearCacheExceptFrame`. Aggressive purging (`UpdateAggressivePurging`) starts only
  once the cache passes `max_decoded_bytes_`, which is unlimited on desktop. So a GIF, an APNG or
  an animated WebP is costed at frames × canvas × 4 bytes: the cache bound is the frame count.
- **JPEG precision and lossless.** The measure costs 8-bit DCT frames. Blink reads scanlines
  as 8-bit samples, so a 12- or 16-bit or lossless (SOF3, SOF7, SOF11, SOF15) primary frame
  is refused rather than costed by a model that doesn't describe it.
- **One gate for every renderer decode.** Main admits Markdown media with `admitRaster`; the
  renderer runs the same check on any Host bytes it turns into an image (the session image
  viewer, attachment previews) and shows nothing when it refuses.

## Consequences

Large animations are refused sooner than a frame-rectangle cost would refuse them: at the
512 MiB budget a 256-frame animation may be about 720 × 720. Formats Blink decodes but the
measure doesn't (ICO, BMP, JPEG XL) never preview.
