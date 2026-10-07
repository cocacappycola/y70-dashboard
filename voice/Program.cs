// ============================================================================
//  Y70 voice helper — Jarvis's ears and mouth.
//
//  One JSON object per line, both ways, like every other helper here.
//
//    -> {"cmd":"wake","on":true,"phrase":"jarvis","sensitivity":0.5}
//    <- {"type":"wake","confidence":0.83,"tail":"set a timer for five minutes"}
//    -> {"cmd":"listen","online":true}
//    <- {"type":"listening","engine":"online"}
//    <- {"type":"partial","text":"what's the weather"}
//    <- {"type":"final","text":"What's the weather like tomorrow?","engine":"online"}
//    -> {"cmd":"speak","id":7,"text":"Clear skies, sir.","voice":"Microsoft Mark"}
//    <- {"type":"tts","id":7,"mime":"audio/wav","data":"<base64>"}
//    -> {"cmd":"game","on":true}
//    <- {"type":"game","on":true,"exe":"r6-siege"}
//
//  Ears: SAPI listens for the name all day, offline, for almost nothing. A
//  request is then heard by the online recognizer (Win+H quality) when that is
//  allowed and wanted, and by SAPI's own dictation when it is not — or when
//  Windows refuses online speech because the privacy switch is off.
// ============================================================================
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Sapi = System.Speech.Recognition;
using WinSR = Windows.Media.SpeechRecognition;
using WinTts = Windows.Media.SpeechSynthesis;

namespace Y70Voice;

internal static class Program
{
    static readonly object _outLock = new();
    static readonly CultureInfo EnUs = new("en-US");

    // ---- wake word
    static Sapi.SpeechRecognitionEngine _wake;
    static string _phrase = "jarvis";
    static bool _wakeWanted;
    static double _wakeMin = 0.5;       // word confidence the name must reach
    static volatile bool _listening;     // a request is being heard
    static volatile bool _speaking;      // Jarvis is talking

    // ---- interrupting him
    // While he talks the mic still listens: "Jarvis..." starts a new request and
    // "stop" ends the answer. What he is saying right now is kept so his own
    // voice, coming back through speakers, cannot set either off.
    static string _speakingText = "";
    static Sapi.Grammar _stopGrammar;
    static bool _stopWords = true;       // "stop", "that's enough"... while he talks
    static bool _bargeIn;                // any speech that isn't him interrupts (headphones)
    static bool _bargeFired;

    // ---- audio for Whisper
    // When on, a heard request carries its own audio (WAV) so the server can
    // have Whisper transcribe it; SAPI then only finds where speech starts and
    // ends and shows the live words.
    static bool _audioOut;

    // ---- request dictation
    static CancellationTokenSource _listenCts;
    static WinSR.SpeechRecognizer _online;

    // ---- game watch
    static Timer _gameTimer;
    static bool _gameOn;
    static int _gameStreak;

    // HRESULT for "the speech privacy policy was not accepted".
    const uint SPERR_PRIVACY = 0x80045509;

    static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        // PowerShell-spawned helpers are DPI-unaware and get virtualised
        // coordinates; the game probe compares real window and monitor rects.
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }

        foreach (var a in args)
            if (a.StartsWith("--parent=") && int.TryParse(a[9..], out var p)) WatchParent(p);

        Emit(new { type = "ready", offline = SapiAvailable(), voices = VoiceList() });

        using var reader = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        string line;
        while ((line = await reader.ReadLineAsync()) != null)
        {
            line = line.Trim();
            if (line.Length == 0) continue;
            try { Dispatch(JsonDocument.Parse(line).RootElement.Clone()); }
            catch (Exception e) { Emit(new { type = "error", where = "command", error = e.Message }); }
        }
        return 0;
    }

    static void Dispatch(JsonElement m)
    {
        switch (Str(m, "cmd"))
        {
            case "wake":
                _wakeWanted = Bool(m, "on", true);
                var ph = Str(m, "phrase");
                if (!string.IsNullOrWhiteSpace(ph)) _phrase = ph.Trim().ToLowerInvariant();
                if (m.TryGetProperty("sensitivity", out var s) && s.TryGetDouble(out var sv))
                    _wakeMin = Math.Clamp(1.0 - sv, 0.2, 0.9);   // more sensitive = lower bar
                _stopWords = Bool(m, "stopWords", _stopWords);
                _bargeIn = Bool(m, "bargeIn", _bargeIn);
                _audioOut = Bool(m, "audio", _audioOut);
                if (_wakeWanted) StartWake(); else StopWake();
                Emit(new { type = "wake-state", on = _wake != null, phrase = _phrase });
                break;
            case "listen":
                // audio:true = record for Whisper (SAPI segments, no online).
                var withAudio = Bool(m, "audio", false);
                _ = Listen(!withAudio && Bool(m, "online", true), Int(m, "maxSeconds", 20), withAudio);
                break;
            case "cancel":
                try { _listenCts?.Cancel(); } catch { }
                break;
            case "speaking":
                var was = _speaking;
                _speaking = Bool(m, "on", false);
                _speakingText = _speaking ? (Str(m, "text") ?? _speakingText) : "";
                if (_speaking && !was) _bargeFired = false;
                try { if (_stopGrammar != null) _stopGrammar.Enabled = _speaking && _stopWords; } catch { }
                break;
            case "speak":
                _ = Speak(m);
                break;
            case "voices":
                Emit(new { type = "voices", voices = VoiceList() });
                break;
            case "game":
                SetGameWatch(Bool(m, "on", true));
                break;
            // Test hooks: run the offline recognizers over a WAV file instead of
            // the microphone, so the grammar can be checked without a person.
            case "test-wake":
                _bargeIn = Bool(m, "bargeIn", _bargeIn);
                _audioOut = Bool(m, "audio", _audioOut);
                _ = TestWake(Str(m, "path"), Bool(m, "speaking", false), Str(m, "speakingText"));
                break;
            case "test-dictate":
                _ = TestDictate(Str(m, "path"));
                break;
            // A whole request heard from a WAV file, through the same events a
            // real one sends (listening, partial, final with audio).
            case "test-listen":
                _ = TestListen(Str(m, "path"));
                break;
            case "tts-file":
                _ = TtsToFile(Str(m, "text"), Str(m, "path"), Str(m, "voice"));
                break;
            default:
                Emit(new { type = "error", where = "command", error = "unknown cmd" });
                break;
        }
    }

    // ======================================================== wake word ====
    // The name on its own, or the name straight into a request ("Jarvis, set a
    // timer for five minutes"). The dictation tail catches what was said in the
    // same breath, so nothing is lost waiting for the chime.
    static Sapi.Grammar WakeGrammar()
    {
        var names = new Sapi.Choices(_phrase, "hey " + _phrase, "okay " + _phrase, "ok " + _phrase);
        var alone = new Sapi.GrammarBuilder(names) { Culture = EnUs };
        var withTail = new Sapi.GrammarBuilder(names) { Culture = EnUs };
        withTail.AppendDictation();
        var either = new Sapi.GrammarBuilder(new Sapi.Choices(alone, withTail)) { Culture = EnUs };
        return new Sapi.Grammar(either) { Name = "wake" };
    }

    // Everything else anyone says lands in this grammar instead, so ordinary
    // speech is not forced into the nearest match to the name.
    static Sapi.Grammar GarbageGrammar() => new Sapi.DictationGrammar { Name = "garbage" };

    // Ways to cut him off. Only enabled while he is talking, and given priority
    // over the dictation grammar, which would otherwise claim a lone "stop".
    static readonly string[] StopPhrases = {
        "stop", "stop it", "stop talking", "that's enough", "enough", "be quiet", "quiet",
        "shut up", "never mind", "cancel", "okay stop", "ok stop", "thanks", "thank you", "got it",
    };
    static Sapi.Grammar StopGrammar()
    {
        var c = new Sapi.Choices(StopPhrases.Concat(StopPhrases.Select(p => _phrase + " " + p)).ToArray());
        return new Sapi.Grammar(new Sapi.GrammarBuilder(c) { Culture = EnUs }) { Name = "stop", Priority = 10 };
    }

    static Sapi.SpeechRecognitionEngine NewWakeEngine()
    {
        var eng = new Sapi.SpeechRecognitionEngine(EnUs);
        var wake = WakeGrammar();
        wake.Priority = 5;
        eng.LoadGrammar(wake);
        eng.LoadGrammar(GarbageGrammar());
        _stopGrammar = StopGrammar();
        _stopGrammar.Enabled = _speaking && _stopWords;
        eng.LoadGrammar(_stopGrammar);
        eng.SpeechRecognized += OnWakeHeard;
        eng.SpeechHypothesized += OnHeardWhileTalking;
        return eng;
    }

    // ---- telling his voice from yours ----
    static string[] Words(string s) =>
        Regex.Matches((s ?? "").ToLowerInvariant(), "[a-z0-9']+").Select(x => x.Value).ToArray();

    // How much of what was heard is just what he is saying right now. Through
    // speakers the mic hears his sentence; that should never interrupt him.
    static double EchoOf(string heard)
    {
        var h = Words(heard);
        if (h.Length == 0 || string.IsNullOrEmpty(_speakingText)) return 0;
        var said = new HashSet<string>(Words(_speakingText));
        return h.Count(w => said.Contains(w)) / (double)h.Length;
    }

    // Talk-over: any speech while he talks that is not an echo of him stops him
    // and opens the mic. Only with bargeIn on — without headphones a room can
    // make his own voice unrecognisable enough to slip past the echo check.
    static void OnHeardWhileTalking(object sender, Sapi.SpeechHypothesizedEventArgs e)
    {
        if (!_speaking || !_bargeIn || _bargeFired || _listening) return;
        var r = e.Result;
        if (r == null || r.Grammar?.Name == "stop") return;
        var w = Words(r.Text);
        if (w.Length < 2 || EchoOf(r.Text) >= 0.5) return;
        _bargeFired = true;
        Emit(new { type = "barge", text = r.Text });
    }

    static void StartWake()
    {
        StopWake();
        if (!_wakeWanted || _listening) return;
        try
        {
            var eng = NewWakeEngine();
            eng.SetInputToDefaultAudioDevice();
            eng.RecognizeAsync(Sapi.RecognizeMode.Multiple);
            _wake = eng;
        }
        catch (Exception e)
        {
            Emit(new { type = "error", where = "wake", error = e.Message });
        }
    }

    static void StopWake()
    {
        var eng = _wake;
        _wake = null;
        if (eng == null) return;
        try { eng.SpeechRecognized -= OnWakeHeard; eng.SpeechHypothesized -= OnHeardWhileTalking; eng.RecognizeAsyncCancel(); } catch { }
        try { eng.Dispose(); } catch { }
        _stopGrammar = null;
    }

    static void OnWakeHeard(object sender, Sapi.SpeechRecognizedEventArgs e) => HandleWake(e.Result, false);

    static readonly Regex Lead = new(@"^\s*(hey|okay|ok)\s+", RegexOptions.IgnoreCase);

    static void HandleWake(Sapi.RecognitionResult r, bool test)
    {
        if (r == null) return;
        var g = r.Grammar?.Name;
        if (g == "stop")
        {
            // Only while he is talking, and never his own words coming back.
            if (!test && (!_speaking || !_stopWords)) return;
            if (!test && EchoOf(r.Text) >= 0.99 && Words(_speakingText).Length > Words(r.Text).Length) return;
            if (r.Confidence < 0.55) { Emit(new { type = "stop-rejected", confidence = Math.Round(r.Confidence, 3), text = r.Text }); return; }
            Emit(new { type = "stop", text = r.Text, confidence = Math.Round(r.Confidence, 3), test });
            return;
        }
        if (g != "wake")
        {
            if (test) Emit(new { type = "test-heard", grammar = g, text = r.Text, confidence = r.Confidence });
            return;
        }
        if (!test && _listening) return;
        // While he talks, the name interrupts him — unless he is the one
        // saying it.
        if (!test && _speaking && Words(_speakingText).Contains(_phrase)) return;
        var nameWord = r.Words.FirstOrDefault(w => string.Equals(w.Text, _phrase, StringComparison.OrdinalIgnoreCase));
        var conf = nameWord?.Confidence ?? r.Confidence;
        if (conf < _wakeMin)
        {
            Emit(new { type = "wake-rejected", confidence = Math.Round(conf, 3), text = r.Text });
            return;
        }
        // What followed the name, if anything.
        var text = Lead.Replace(r.Text, "");
        var tail = Regex.Replace(text, "^" + Regex.Escape(_phrase) + @"[\s,.!?]*", "", RegexOptions.IgnoreCase).Trim();
        // With Whisper on, a request said in the same breath travels with its
        // audio, so it can be transcribed properly instead of taken from SAPI.
        string audio = null;
        if (_audioOut && tail.Length > 0) audio = WavBase64(r.Audio);
        Emit(new { type = "wake", confidence = Math.Round(conf, 3), tail, test, interrupted = _speaking, audio });
    }

    static string WavBase64(Sapi.RecognizedAudio a)
    {
        if (a == null) return null;
        try
        {
            using var ms = new MemoryStream();
            a.WriteToWaveStream(ms);
            return Convert.ToBase64String(ms.ToArray());
        }
        catch { return null; }
    }

    // ========================================================= requests ====
    static async Task Listen(bool online, int maxSeconds, bool withAudio)
    {
        if (_listening) return;
        _listening = true;
        StopWake();
        _listenCts = new CancellationTokenSource(TimeSpan.FromSeconds(Math.Clamp(maxSeconds, 3, 60)));
        var ct = _listenCts.Token;
        string text = null, engine = null, reason = null, audio = null;
        try
        {
            if (online)
            {
                Emit(new { type = "listening", engine = "online" });
                var r = await ListenOnline(ct);
                if (r.ok) { text = r.text; engine = "online"; }
                else if (r.privacy)
                {
                    // Windows says no until Online speech recognition is switched
                    // on. Say why once, then do the job offline anyway.
                    Emit(new { type = "online-unavailable", reason = "privacy" });
                    online = false;
                }
                else reason = r.error;
            }
            if (!online && !ct.IsCancellationRequested)
            {
                Emit(new { type = "listening", engine = withAudio ? "whisper" : "offline" });
                var r = await ListenOffline(ct, null);
                text = r.text;
                if (withAudio) audio = r.audio;
                engine = withAudio ? "whisper" : "offline";
            }
        }
        catch (Exception e) { reason = e.Message; }
        finally
        {
            _listening = false;
            Emit(new { type = "final", text = text ?? "", engine, audio, reason = ct.IsCancellationRequested && text == null ? "cancelled" : reason });
            StartWake();
        }
    }

    static async Task<(bool ok, string text, bool privacy, string error)> ListenOnline(CancellationToken ct)
    {
        try
        {
            if (_online == null)
            {
                var rec = new WinSR.SpeechRecognizer(new Windows.Globalization.Language("en-US"));
                rec.Constraints.Add(new WinSR.SpeechRecognitionTopicConstraint(WinSR.SpeechRecognitionScenario.Dictation, "dictation"));
                var compiled = await rec.CompileConstraintsAsync();
                if (compiled.Status != WinSR.SpeechRecognitionResultStatus.Success)
                {
                    rec.Dispose();
                    return (false, null, false, "compile " + compiled.Status);
                }
                rec.Timeouts.InitialSilenceTimeout = TimeSpan.FromSeconds(6);
                rec.Timeouts.EndSilenceTimeout = TimeSpan.FromSeconds(0.9);
                rec.HypothesisGenerated += (_, e) => Emit(new { type = "partial", text = e.Hypothesis.Text });
                _online = rec;
            }
            var res = await _online.RecognizeAsync().AsTask(ct);
            if (res.Status == WinSR.SpeechRecognitionResultStatus.Success) return (true, res.Text, false, null);
            return (false, null, false, res.Status.ToString());
        }
        catch (OperationCanceledException) { return (false, null, false, "cancelled"); }
        catch (Exception e) when ((uint)e.HResult == SPERR_PRIVACY)
        {
            try { _online?.Dispose(); } catch { }
            _online = null;
            return (false, null, true, "privacy");
        }
        catch (Exception e)
        {
            try { _online?.Dispose(); } catch { }
            _online = null;
            return (false, null, false, e.Message);
        }
    }

    // SAPI dictation, from the microphone or (for tests) a WAV file. Returns
    // the words SAPI heard and the audio it heard them in (WAV, base64): with
    // Whisper on, SAPI is only the ears that know when you have finished.
    static async Task<(string text, string audio)> ListenOffline(CancellationToken ct, string wavPath)
    {
        var done = new TaskCompletionSource<(string, string)>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var eng = new Sapi.SpeechRecognitionEngine(EnUs);
        eng.LoadGrammar(new Sapi.DictationGrammar());
        if (wavPath != null) eng.SetInputToWaveFile(wavPath); else eng.SetInputToDefaultAudioDevice();
        eng.InitialSilenceTimeout = TimeSpan.FromSeconds(6);
        // A beat longer than SAPI's own default, so a breath mid-sentence does
        // not end the request.
        eng.EndSilenceTimeout = TimeSpan.FromSeconds(1.0);
        eng.BabbleTimeout = TimeSpan.FromSeconds(4);
        // A rejected utterance (too unsure to name) still has its audio, which
        // Whisper may well make sense of.
        Sapi.RecognitionResult heard = null;
        eng.SpeechRecognized += (_, e) => heard = e.Result;
        eng.SpeechRecognitionRejected += (_, e) => { if (heard == null) heard = e.Result; };
        eng.SpeechHypothesized += (_, e) => Emit(new { type = "partial", text = e.Result.Text });
        var lastLevel = 0L;
        eng.AudioLevelUpdated += (_, e) =>
        {
            var now = Environment.TickCount64;
            if (now - lastLevel < 80) return;
            lastLevel = now;
            Emit(new { type = "level", v = e.AudioLevel });
        };
        eng.RecognizeCompleted += (_, e) =>
        {
            var r = e.Result ?? heard;
            done.TrySetResult((e.Result?.Text, WavBase64(r?.Audio)));
        };
        eng.RecognizeAsync(Sapi.RecognizeMode.Single);
        using (ct.Register(() => { try { eng.RecognizeAsyncCancel(); } catch { } }))
            return await done.Task;
    }

    // ============================================================ voice ====
    static object VoiceList()
    {
        try
        {
            return WinTts.SpeechSynthesizer.AllVoices
                .Select(v => new { name = v.DisplayName, lang = v.Language, gender = v.Gender.ToString() })
                .ToArray();
        }
        catch { return Array.Empty<object>(); }
    }

    static WinTts.VoiceInformation FindVoice(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        return WinTts.SpeechSynthesizer.AllVoices.FirstOrDefault(v =>
            string.Equals(v.DisplayName, name, StringComparison.OrdinalIgnoreCase) ||
            v.DisplayName.Contains(name, StringComparison.OrdinalIgnoreCase));
    }

    static async Task<(byte[] data, string mime)> Synthesize(string text, string voice, double rate, double pitch)
    {
        using var synth = new WinTts.SpeechSynthesizer();
        var v = FindVoice(voice);
        if (v != null) synth.Voice = v;
        synth.Options.SpeakingRate = Math.Clamp(rate, 0.5, 3.0);
        synth.Options.AudioPitch = Math.Clamp(pitch, 0.0, 2.0);
        using var stream = await synth.SynthesizeTextToStreamAsync(text);
        using var input = stream.AsStreamForRead();
        using var ms = new MemoryStream();
        await input.CopyToAsync(ms);
        return (ms.ToArray(), stream.ContentType);
    }

    static async Task Speak(JsonElement m)
    {
        var id = Int(m, "id", 0);
        try
        {
            var (data, mime) = await Synthesize(Str(m, "text") ?? "", Str(m, "voice"),
                Dbl(m, "rate", 1.0), Dbl(m, "pitch", 1.0));
            Emit(new { type = "tts", id, mime, data = Convert.ToBase64String(data) });
        }
        catch (Exception e) { Emit(new { type = "tts", id, error = e.Message }); }
    }

    // ============================================================= game ====
    // "Playing a game" = some other program's window is in front and fills its
    // whole monitor (borderless or exclusive fullscreen). Browsers are left out
    // unless Windows itself reports exclusive D3D: a fullscreen video is not a
    // reason to give the GPU back. Debounced so alt-tabbing does not flap.
    static readonly HashSet<string> NotGames = new(StringComparer.OrdinalIgnoreCase)
    {
        "explorer", "ShellExperienceHost", "StartMenuExperienceHost", "SearchHost", "LockApp",
        "ApplicationFrameHost", "TextInputHost", "y70-voice", "Y70 Dashboard", "electron",
        "chrome", "msedge", "brave", "firefox", "opera", "vivaldi",
    };

    static void SetGameWatch(bool on)
    {
        _gameTimer?.Dispose();
        _gameTimer = null;
        _gameStreak = 0;
        if (!on) { _gameOn = false; return; }
        // Say where things stand now rather than only on the next change.
        try
        {
            var (playing, exe) = ProbeGame();
            _gameOn = playing;
            Emit(new { type = "game", on = playing, exe });
        }
        catch { }
        _gameTimer = new Timer(_ => GameTick(), null, 3000, 3000);
    }

    static void GameTick()
    {
        try
        {
            var (playing, exe) = ProbeGame();
            if (playing == _gameOn) { _gameStreak = 0; return; }
            // Two looks to come on (~6s), three to go off (~9s).
            _gameStreak++;
            if (_gameStreak < (playing ? 2 : 3)) return;
            _gameStreak = 0;
            _gameOn = playing;
            Emit(new { type = "game", on = playing, exe });
        }
        catch (Exception e) { Emit(new { type = "error", where = "game", error = e.Message }); }
    }

    static (bool, string) ProbeGame()
    {
        var hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return (false, null);
        GetWindowThreadProcessId(hwnd, out var pid);
        string exe;
        try { exe = Process.GetProcessById((int)pid).ProcessName; } catch { return (false, null); }
        if (pid == Environment.ProcessId) return (false, null);

        SHQueryUserNotificationState(out var quns);
        if (quns == 3) return (true, exe);                    // QUNS_RUNNING_D3D_FULL_SCREEN
        if (NotGames.Contains(exe)) return (false, exe);

        if (!GetWindowRect(hwnd, out var wr)) return (false, exe);
        var mon = MonitorFromWindow(hwnd, 2);
        var mi = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
        if (!GetMonitorInfo(mon, ref mi)) return (false, exe);
        var m = mi.rcMonitor;
        var fills = wr.Left <= m.Left && wr.Top <= m.Top && wr.Right >= m.Right && wr.Bottom >= m.Bottom;
        return (fills, exe);
    }

    // ============================================================ tests ====
    // The live wake engine (all three grammars, every guard) over a WAV file.
    // With speaking set, it behaves as if Jarvis were in the middle of saying
    // speakingText — which is how interruptions are tested without a person.
    static async Task TestWake(string path, bool speaking, string speakingText)
    {
        var done = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var wasSpeaking = _speaking; var wasText = _speakingText;
        _speaking = speaking; _speakingText = speakingText ?? ""; _bargeFired = false;
        using var eng = NewWakeEngine();
        eng.SpeechRecognized -= OnWakeHeard;
        eng.SpeechRecognized += (_, e) => { Emit(new { type = "test-heard", grammar = e.Result.Grammar?.Name, text = e.Result.Text, confidence = Math.Round(e.Result.Confidence, 3) }); HandleWake(e.Result, false); };
        eng.RecognizeCompleted += (_, _) => done.TrySetResult(true);
        eng.SetInputToWaveFile(path);
        eng.RecognizeAsync(Sapi.RecognizeMode.Multiple);
        await done.Task;
        eng.SpeechHypothesized -= OnHeardWhileTalking;
        _speaking = wasSpeaking; _speakingText = wasText;
        Emit(new { type = "test-done", what = "wake", path, speaking });
    }

    static async Task TestListen(string path)
    {
        Emit(new { type = "listening", engine = "whisper" });
        var (text, audio) = await ListenOffline(CancellationToken.None, path);
        Emit(new { type = "final", text = text ?? "", engine = "whisper", audio, reason = (string)null });
    }

    static async Task TestDictate(string path)
    {
        var (text, audio) = await ListenOffline(CancellationToken.None, path);
        Emit(new { type = "test-done", what = "dictate", path, text, audioBytes = audio == null ? 0 : audio.Length * 3 / 4, audio });
    }

    static async Task TtsToFile(string text, string path, string voice)
    {
        try
        {
            var (data, _) = await Synthesize(text, voice, 1.0, 1.0);
            await File.WriteAllBytesAsync(path, data);
            Emit(new { type = "test-done", what = "tts-file", path, bytes = data.Length });
        }
        catch (Exception e) { Emit(new { type = "error", where = "tts-file", error = e.Message }); }
    }

    // ============================================================ plumbing ==
    static bool SapiAvailable()
    {
        try { return Sapi.SpeechRecognitionEngine.InstalledRecognizers().Any(r => r.Culture.Name == "en-US"); }
        catch { return false; }
    }

    static void WatchParent(int pid)
    {
        new Thread(() =>
        {
            while (true)
            {
                Thread.Sleep(2000);
                try { if (Process.GetProcessById(pid).HasExited) Environment.Exit(0); }
                catch { Environment.Exit(0); }
            }
        }) { IsBackground = true }.Start();
    }

    static void Emit(object o)
    {
        var s = JsonSerializer.Serialize(o);
        lock (_outLock) { Console.Out.Write(s + "\n"); Console.Out.Flush(); }
    }

    static string Str(JsonElement m, string k) =>
        m.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    static bool Bool(JsonElement m, string k, bool d) =>
        m.TryGetProperty(k, out var v) && (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False) ? v.GetBoolean() : d;
    static int Int(JsonElement m, string k, int d) =>
        m.TryGetProperty(k, out var v) && v.TryGetInt32(out var i) ? i : d;
    static double Dbl(JsonElement m, string k, double d) =>
        m.TryGetProperty(k, out var v) && v.TryGetDouble(out var x) ? x : d;

    // ---- Win32
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor, rcWork; public uint dwFlags; }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
    [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);
}
