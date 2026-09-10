// tts_service.dart: text-to-speech para flashcards.
//
// v0.60 (P1.3): pronuncia la respuesta de la flashcard durante el review.
// AnkiDroid tiene esto built-in via TTS plugin. Aqui usamos flutter_tts.

import 'package:flutter_tts/flutter_tts.dart';
import 'logger.dart';

class TtsService {
  final FlutterTts _tts = FlutterTts();
  bool _initialized = false;
  String _currentLang = 'es-ES';
  double _rate = 0.5;
  double _pitch = 1.0;
  double _volume = 1.0;

  TtsService();

  Future<void> init({String lang = 'es-ES'}) async {
    if (_initialized) return;
    try {
      await _tts.setLanguage(lang);
      _currentLang = lang;
      await _tts.setSpeechRate(_rate);
      await _tts.setPitch(_pitch);
      await _tts.setVolume(_volume);
      // iOS: AVAudioSession category
      // await _tts.setSharedInstance(true);
      // await _tts.setIosAudioCategory(IosTextToSpeechAudioCategory.playback, [
      //   IosTextToSpeechAudioMode.spokenAudio
      // ]);
      _initialized = true;
    } catch (e) {
      AdvancedLogger.instance.warn('tts', 'init failed', error: e.toString());
    }
  }

  /// v0.60 (P1.3): reproduce texto.
  Future<void> speak(String text) async {
    if (text.trim().isEmpty) return;
    if (!_initialized) await init();
    try {
      await _tts.stop();
      await _tts.speak(text);
    } catch (e) {
      AdvancedLogger.instance.warn('tts', 'speak failed', error: e.toString());
    }
  }

  /// v0.60 (P1.3): detiene cualquier reproduccion.
  Future<void> stop() async {
    try { await _tts.stop(); } catch (_) {}
  }

  /// v0.60 (P1.3): cambia el idioma.
  Future<void> setLanguage(String lang) async {
    _currentLang = lang;
    if (_initialized) {
      try { await _tts.setLanguage(lang); } catch (_) {}
    }
  }

  /// v0.60 (P1.3): cambia la velocidad (0.0 = muy lento, 1.0 = normal, 2.0 = rapido).
  Future<void> setRate(double rate) async {
    _rate = rate.clamp(0.0, 2.0);
    if (_initialized) {
      try { await _tts.setSpeechRate(_rate); } catch (_) {}
    }
  }

  /// v0.60 (P1.3): idiomas soportados (subset comun para flashcards).
  static const supportedLanguages = {
    'es-ES': 'Español (España)',
    'es-MX': 'Español (México)',
    'en-US': 'English (US)',
    'en-GB': 'English (UK)',
    'fr-FR': 'Français',
    'de-DE': 'Deutsch',
    'it-IT': 'Italiano',
    'pt-BR': 'Português (Brasil)',
    'pt-PT': 'Português (Portugal)',
    'ja-JP': '日本語',
    'zh-CN': '中文 (简体)',
    'la': 'Latina', // para anatomía
  };

  String get currentLang => _currentLang;
}
