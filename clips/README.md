# Clips

Video files in this folder are listed on the clip stage. Input is video files only.

| File | What it is | Source |
|---|---|---|
| `firestarter-choreo.mp4` | K/DA, "FIRESTARTER", the official choreography video. 195.6 s, 854x480, H.264, 23.98 fps, **no audio stream**, about 12.7 MB. | https://www.youtube.com/watch?v=Ko9VF6dDnAk |
| `firestarter-choreo.source.json` | Small record of the source: URL, title, uploader, size. | written by hand |

## Copyright

`firestarter-choreo.mp4` is third-party copyrighted material (Riot Games). It is kept locally for a
live demo only: video files in this folder are git-ignored, and it must not be redistributed.

Its soundtrack is not in this project. Reference beat times were measured from the soundtrack once,
to grade the movement-only beat tracker (`eval/ground-truth/firestarter-choreo/beats.json`); the music
is never used to compose.

## Adding a clip

Drop any video file here or onto the page, or fetch one and strip its audio:

```bash
node tools/fetch-clip.mjs "<video url>" <name>     # writes clips/<name>.mp4, H.264, at most 720p, no audio
```

Check a clip has no audio and decodes cleanly:

```bash
node_modules/ffmpeg-static/ffmpeg -hide_banner -i clips/<name>.mp4             # stream list: video only
node_modules/ffmpeg-static/ffmpeg -v error -i clips/<name>.mp4 -f null -       # full decode, prints nothing when fine
```
