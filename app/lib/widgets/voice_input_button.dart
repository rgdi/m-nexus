// voice_input_button.dart: botón de micrófono integrable en cualquier editor (Fase 1.D.3).
//
// v0.46: usa el VoiceNoteService (Fase 1.D.2) para grabar audio y
// enviarlo al backend para transcripción. Inserta el texto transcrito
// en el TextEditingController del editor.
//
// Uso:
//   VoiceInputButton(
//     controller: myTextController,
//     backendUrl: 'http://10.0.2.2:4000', // Android emulator → host
//     authToken: jwt,
//   )

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;
import 'package:permission_handler/permission_handler.dart';
import '../services/voice_note_service.dart';

class VoiceInputButton extends StatefulWidget {
  /// Text controller al que se inserta el texto transcrito
  final TextEditingController controller;

  /// URL del backend M-NEXUS (opcional, para hybrid mode)
  final String? backendUrl;

  /// Token JWT para autenticacion con backend
  final String? authToken;

  /// Modo de transcripcion: local (STT en dispositivo) o remote (Whisper en backend)
  final TranscriptionMode mode;

  /// Idioma (default: 'es')
  final String language;

  /// Locale
  final String? localeCode;

  const VoiceInputButton({
    super.key,
    required this.controller,
    this.backendUrl,
    this.authToken,
    this.mode = TranscriptionMode.local,
    this.language = 'es',
    this.localeCode,
  });

  @override
  State<VoiceInputButton> createState() => _VoiceInputButtonState();
}

class _VoiceInputButtonState extends State<VoiceInputButton> with SingleTickerProviderStateMixin {
  late final stt.SpeechToText _speech;
  late final VoiceNoteService _voiceService;
  bool _isListening = false;
  bool _isProcessing = false;
  bool _speechAvailable = false;
  String _transcript = '';
  late AnimationController _pulseAnim;
  Timer? _maxDurationTimer;

  static const _maxListenSeconds = 60;

  @override
  void initState() {
    super.initState();
    _speech = stt.SpeechToText();
    _voiceService = VoiceNoteService();
    _pulseAnim = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    )..repeat(reverse: true);
    _initSpeech();
  }

  Future<void> _initSpeech() async {
    try {
      _speechAvailable = await _speech.initialize(
        onError: (e) => debugPrint('STT error: $e'),
        onStatus: (s) {
          if (s == 'done' || s == 'notListening') {
            setState(() => _isListening = false);
            _pulseAnim.stop();
          }
        },
      );
      if (mounted) setState(() {});
    } catch (e) {
      _speechAvailable = false;
      if (mounted) setState(() {});
    }
  }

  @override
  void dispose() {
    _pulseAnim.dispose();
    _maxDurationTimer?.cancel();
    if (_isListening) {
      _speech.stop();
    }
    super.dispose();
  }

  Future<bool> _requestPermission() async {
    final status = await Permission.microphone.request();
    return status.isGranted;
  }

  Future<void> _startListening() async {
    if (_isListening) return;

    // Request permission
    final granted = await _requestPermission();
    if (!granted) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Microphone permission denied'),
            backgroundColor: Colors.red,
          ),
        );
      }
      return;
    }

    setState(() {
      _isListening = true;
      _transcript = '';
    });
    _pulseAnim.forward();

    // Auto-stop after max duration
    _maxDurationTimer?.cancel();
    _maxDurationTimer = Timer(const Duration(seconds: _maxListenSeconds), _stopListening);

    if (widget.mode == TranscriptionMode.local && _speechAvailable) {
      // Local STT: streaming transcription
      await _speech.listen(
        onResult: (result) {
          setState(() {
            _transcript = result.recognizedWords;
          });
          if (result.finalResult) {
            _insertTranscript(_transcript);
            _stopListening();
          }
        },
        localeId: widget.localeCode ?? _localeForLanguage(widget.language),
        listenOptions: stt.SpeechListenOptions(
          partialResults: true,
          cancelOnError: true,
        ),
      );
    } else {
      // Remote: record audio + send to backend
      try {
        await _voiceService.startRecording();
        setState(() => _isProcessing = false);
      } catch (e) {
        debugPrint('Recording failed: $e');
        _stopListening();
      }
    }
  }

  Future<void> _stopListening() async {
    if (!_isListening) return;
    _maxDurationTimer?.cancel();
    _pulseAnim.stop();

    if (widget.mode == TranscriptionMode.local && _speechAvailable) {
      await _speech.stop();
    } else {
      // Remote: stop recording + transcribe
      setState(() {
        _isListening = false;
        _isProcessing = true;
      });
      try {
        final audio = await _voiceService.stopRecording();
        if (audio.lengthInBytes > 0 && widget.backendUrl != null) {
          final text = await _voiceService.transcribe(
            audio,
            backendUrl: widget.backendUrl!,
            authToken: widget.authToken,
            language: widget.language,
          );
          _insertTranscript(text);
        }
      } catch (e) {
        debugPrint('Transcription failed: $e');
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Transcription failed: $e'),
              backgroundColor: Colors.red,
            ),
          );
        }
      } finally {
        setState(() => _isProcessing = false);
      }
    }

    setState(() => _isListening = false);
  }

  void _insertTranscript(String text) {
    if (text.trim().isEmpty) return;
    final current = widget.controller.text;
    final selection = widget.controller.selection;
    final insertionPoint = selection.isValid ? selection.start : current.length;
    final newText = current.substring(0, insertionPoint) +
        (current.isNotEmpty && insertionPoint > 0 ? ' ' : '') +
        text +
        current.substring(insertionPoint);
    widget.controller.value = TextEditingValue(
      text: newText,
      selection: TextSelection.collapsed(offset: insertionPoint + text.length + 1),
    );
  }

  String _localeForLanguage(String lang) {
    switch (lang) {
      case 'es': return 'es_ES';
      case 'en': return 'en_US';
      case 'pt': return 'pt_BR';
      default: return lang;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    if (!_speechAvailable && widget.mode == TranscriptionMode.local) {
      // Fallback: just show disabled button
      return IconButton(
        icon: Icon(Icons.mic_off, color: theme.disabledColor),
        tooltip: 'Speech recognition not available',
        onPressed: null,
      );
    }

    return AnimatedBuilder(
      animation: _pulseAnim,
      builder: (context, child) {
        final scale = _isListening ? 1.0 + (_pulseAnim.value * 0.15) : 1.0;
        return Transform.scale(
          scale: scale,
          child: child,
        );
      },
      child: Stack(
        alignment: Alignment.center,
        children: [
          if (_isListening)
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                color: Colors.red.withValues(alpha: 0.2),
                shape: BoxShape.circle,
              ),
            ),
          Material(
            color: _isListening ? Colors.red : theme.colorScheme.primary,
            shape: const CircleBorder(),
            elevation: _isListening ? 4 : 2,
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: _isProcessing ? null : (_isListening ? _stopListening : _startListening),
              child: SizedBox(
                width: 48,
                height: 48,
                child: _isProcessing
                    ? const Padding(
                        padding: EdgeInsets.all(12),
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : Icon(
                        _isListening ? Icons.stop : Icons.mic,
                        color: Colors.white,
                        size: 24,
                      ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Botón compacto (icono pequeño) para integrar en AppBar o toolbars.
class VoiceInputIconButton extends StatelessWidget {
  final TextEditingController controller;
  final String? backendUrl;
  final String? authToken;
  final TranscriptionMode mode;
  final String language;

  const VoiceInputIconButton({
    super.key,
    required this.controller,
    this.backendUrl,
    this.authToken,
    this.mode = TranscriptionMode.local,
    this.language = 'es',
  });

  @override
  Widget build(BuildContext context) {
    return VoiceInputButton(
      controller: controller,
      backendUrl: backendUrl,
      authToken: authToken,
      mode: mode,
      language: language,
    );
  }
}
