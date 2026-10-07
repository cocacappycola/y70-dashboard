# Jarvis's voice: Kokoro-82M through kokoro-onnx, kept loaded.
#
#   python tts-kokoro.py <model.onnx> <voices.bin>
#
# One JSON object per line, both ways, like every other helper here:
#   <- {"type":"ready","voices":["af_heart","bm_george",...]}
#   -> {"id":7,"text":"Good evening.","voice":"bm_george","speed":1.0}
#   <- {"type":"tts","id":7,"mime":"audio/wav","data":"<base64>"}
#
# Voices starting with "b" are British and are spoken with British English
# pronunciation; the rest American. Runs on the CPU (no VRAM taken from games
# or the local models). Exits when the dashboard closes its stdin.
import base64
import io
import json
import sys
import wave


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def to_wav(samples, rate):
    import numpy as np
    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def main():
    model, voices_file = sys.argv[1], sys.argv[2]
    try:
        from kokoro_onnx import Kokoro
        k = Kokoro(model, voices_file)
        voices = sorted(k.get_voices())
    except Exception as e:  # noqa: BLE001 - reported to the dashboard
        emit({"type": "error", "error": type(e).__name__ + ": " + str(e)})
        return 1
    # The first synthesis pays for warming the ONNX session; pay it now.
    try:
        k.create("Ready.", voice=voices[0], speed=1.0, lang="en-us")
    except Exception:  # noqa: BLE001
        pass
    emit({"type": "ready", "voices": voices})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            voice = req.get("voice") or "bm_george"
            if voice not in voices:
                voice = "bm_george" if "bm_george" in voices else voices[0]
            lang = "en-gb" if voice.startswith("b") else "en-us"
            speed = max(0.5, min(2.0, float(req.get("speed") or 1.0)))
            text = str(req.get("text") or "").strip()[:2000]
            if not text:
                emit({"type": "tts", "id": rid, "error": "no text"})
                continue
            samples, rate = k.create(text, voice=voice, speed=speed, lang=lang)
            emit({"type": "tts", "id": rid, "mime": "audio/wav", "data": base64.b64encode(to_wav(samples, rate)).decode("ascii")})
        except Exception as e:  # noqa: BLE001
            emit({"type": "tts", "id": rid, "error": type(e).__name__ + ": " + str(e)})
    return 0


if __name__ == "__main__":
    sys.exit(main())
