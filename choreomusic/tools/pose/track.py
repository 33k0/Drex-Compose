"""Body tracking for Drex Choreomusic.

Follows up to a few people through a video with MediaPipe Pose and writes their joint positions,
frame by frame, as JSON. No audio is read. The beat analysis itself happens in the server
(server/video/beat.ts); this script only measures where the bodies are.

    uv run --python 3.12 --with mediapipe --with opencv-python-headless \
        python tools/pose/track.py <video> <out.json> --model <pose_landmarker.task> [--people 4]
"""
import argparse, json, sys
import cv2, numpy as np, mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

# The thirteen joints the beat analysis uses, by MediaPipe landmark index.
JOINTS = {"nose": 0, "l_shoulder": 11, "r_shoulder": 12, "l_elbow": 13, "r_elbow": 14, "l_wrist": 15, "r_wrist": 16,
          "l_hip": 23, "r_hip": 24, "l_knee": 25, "r_knee": 26, "l_ankle": 27, "r_ankle": 28}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video"); ap.add_argument("out"); ap.add_argument("--model", required=True)
    ap.add_argument("--people", type=int, default=4); ap.add_argument("--long-side", type=int, default=640)
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        sys.exit(f"cannot open {args.video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=args.model),
        running_mode=vision.RunningMode.VIDEO, num_poses=args.people,
        min_pose_detection_confidence=0.4, min_pose_presence_confidence=0.4, min_tracking_confidence=0.4)
    idx = list(JOINTS.values())
    tracks = []   # last known hip centre of each identity
    frames = []
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        i = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            h, w = frame.shape[:2]
            scale = args.long_side / max(h, w)
            if scale < 1:
                frame = cv2.resize(frame, (int(w * scale), int(h * scale)))
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = landmarker.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(i * 1000 / fps))
            people = []
            for lm in result.pose_landmarks:
                pts = [[round(lm[j].x, 4), round(lm[j].y, 4), round(lm[j].visibility, 2)] for j in idx]
                people.append(pts)
            # Keep identities stable from frame to frame: each detection goes to the nearest previous hip centre.
            centres = [((p[7][0] + p[8][0]) / 2, (p[7][1] + p[8][1]) / 2) for p in people]
            slots = [None] * max(len(tracks), 0)
            free = list(range(len(people)))
            for t_i, c in sorted(enumerate(tracks), key=lambda x: x[0]):
                if not free or c is None:
                    continue
                best = min(free, key=lambda k: (centres[k][0] - c[0]) ** 2 + (centres[k][1] - c[1]) ** 2)
                if (centres[best][0] - c[0]) ** 2 + (centres[best][1] - c[1]) ** 2 < 0.02:
                    slots[t_i] = people[best]; tracks[t_i] = centres[best]; free.remove(best)
            for k in free:
                tracks.append(centres[k]); slots.append(people[k])
            frames.append({"t": round(i / fps, 4), "people": slots})
            i += 1
            if i % 200 == 0:
                print(f"{i}/{total}", file=sys.stderr, flush=True)
    cap.release()
    json.dump({"fps": fps, "joints": list(JOINTS.keys()), "frames": frames}, open(args.out, "w"), separators=(",", ":"))
    seen = [sum(1 for f in frames if k < len(f["people"]) and f["people"][k]) for k in range(len(tracks))]
    print(json.dumps({"frames": len(frames), "fps": fps, "identities": len(tracks), "framesSeenPerIdentity": seen}))

if __name__ == "__main__":
    main()
