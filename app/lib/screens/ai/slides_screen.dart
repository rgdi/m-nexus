// slides_screen.dart — Genera presentación desde una nota.
// v0.62.16: AFFiNE genera slides con templates JSON. Aquí lo simplificamos:
// el AI devuelve una lista de títulos (uno por slide) y el contenido se
// renderiza como páginas swipeables.

import 'package:flutter/material.dart';
import '../../core/design_tokens.dart';
import '../../services/ai_tutor_client.dart';
import '../../services/settings_service.dart';
import '../../services/vault_service.dart';
import '../../widgets/empty_state.dart';

class SlidesScreen extends StatefulWidget {
  final String vaultPath;
  final String sourceNotePath;
  const SlidesScreen({
    super.key,
    required this.vaultPath,
    required this.sourceNotePath,
  });
  @override
  State<SlidesScreen> createState() => _SlidesScreenState();
}

class _Slide {
  final String title;
  final List<String> bullets;
  _Slide(this.title, this.bullets);
}

class _SlidesScreenState extends State<SlidesScreen> {
  AiTutorClient? _tutor;
  List<_Slide> _slides = [];
  bool _generating = false;
  String? _error;
  int _current = 0;
  final _pageCtrl = PageController();

  @override
  void initState() {
    super.initState();
    _tutor = AiTutorClient(
      backendUrl: SettingsService.instance.current.backendUrl ?? '',
    );
    _generate();
  }

  Future<void> _generate() async {
    if (_tutor == null) return;
    final v = VaultService(widget.vaultPath);
    final note = await v.readNote(widget.sourceNotePath);
    if (note == null) return;
    setState(() {
      _generating = true;
      _error = null;
      _slides = [];
      _current = 0;
    });
    try {
      final prompt = '''
Convierte el siguiente contenido en una presentación de 6-10 slides.
Responde SOLO con JSON válido (sin markdown):
[
  {"title": "Slide 1", "bullets": ["bullet 1", "bullet 2"]},
  {"title": "Slide 2", "bullets": [...]}
]

Contenido:
${note.content.length > 4000 ? note.content.substring(0, 4000) : note.content}
''';
      final resp = await _tutor!.ask(prompt, context: '');
      final slides = _parseSlides(resp.answer);
      if (mounted) setState(() {
        _slides = slides;
        _generating = false;
        _current = 0;
        if (_pageCtrl.hasClients) _pageCtrl.jumpToPage(0);
      });
    } catch (e) {
      if (mounted) setState(() {
        _error = '$e';
        _generating = false;
      });
    }
  }

  List<_Slide> _parseSlides(String text) {
    final start = text.indexOf('[');
    final end = text.lastIndexOf(']');
    if (start < 0 || end < 0) return [_Slide('Sin respuesta válida', [text.substring(0, text.length.clamp(0, 200))])];
    final body = text.substring(start, end + 1);
    final slides = <_Slide>[];
    int depth = 0;
    int objStart = -1;
    for (int i = 0; i < body.length; i++) {
      if (body[i] == '{') {
        if (depth == 0) objStart = i;
        depth++;
      } else if (body[i] == '}') {
        depth--;
        if (depth == 0 && objStart >= 0) {
          slides.add(_parseSlide(body.substring(objStart, i + 1)));
          objStart = -1;
        }
      }
    }
    return slides.isEmpty ? [_Slide('Sin slides', ['No se pudo parsear'])] : slides;
  }

  _Slide _parseSlide(String jsonStr) {
    final titleMatch = RegExp(r'"title"\s*:\s*"([^"]+)"').firstMatch(jsonStr);
    final title = titleMatch?.group(1) ?? '?';
    final bullets = <String>[];
    final bulletsMatch = RegExp(r'"bullets"\s*:\s*\[(.*?)\](?=\s*[,\}])', dotAll: true).firstMatch(jsonStr);
    if (bulletsMatch != null) {
      final items = RegExp(r'"([^"]+)"').allMatches(bulletsMatch.group(1)!);
      for (final m in items) {
        final s = m.group(1) ?? '';
        if (s.length > 2 && s != 'bullets') bullets.add(s);
      }
    }
    return _Slide(title, bullets);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: theme.colorScheme.surface,
      appBar: AppBar(
        title: const Text('AI Slides', style: TextStyle(fontWeight: FontWeight.w700)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _generating ? null : _generate,
          ),
        ],
      ),
      body: _error != null
          ? Center(child: Text('Error: $_error', style: const TextStyle(color: Colors.red)))
          : _generating
              ? const Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      CircularProgressIndicator(),
                      SizedBox(height: 16),
                      Text('Generando slides...'),
                    ],
                  ),
                )
              : _slides.isEmpty
                  ? const EmptyState(
                      icon: Icons.slideshow_outlined,
                      title: 'Sin slides',
                    )
                  : Column(
                      children: [
                        Expanded(
                          child: PageView.builder(
                            controller: _pageCtrl,
                            onPageChanged: (i) => setState(() => _current = i),
                            itemCount: _slides.length,
                            itemBuilder: (ctx, i) {
                              return _SlideView(slide: _slides[i], index: i + 1);
                            },
                          ),
                        ),
                        // Pager indicator.
                        Padding(
                          padding: const EdgeInsets.all(16),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: List.generate(_slides.length, (i) =>
                              Container(
                                width: i == _current ? 24 : 8,
                                height: 8,
                                margin: const EdgeInsets.symmetric(horizontal: 3),
                                decoration: BoxDecoration(
                                  color: i == _current
                                      ? MxColors.indigoDeep
                                      : theme.colorScheme.outlineVariant,
                                  borderRadius: BorderRadius.circular(4),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
    );
  }
}

class _SlideView extends StatelessWidget {
  final _Slide slide;
  final int index;
  const _SlideView({required this.slide, required this.index});
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.all(20),
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF5B5BD6), Color(0xFF8B5CF6)],
        ),
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 12, offset: Offset(0, 6))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('$index / ${slide.bullets.length + 0}',
            style: theme.textTheme.labelMedium?.copyWith(color: Colors.white70)),
          const SizedBox(height: 16),
          Text(slide.title,
            style: theme.textTheme.headlineMedium?.copyWith(
              color: Colors.white,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.5,
            )),
          const SizedBox(height: 24),
          Expanded(
            child: ListView.separated(
              itemCount: slide.bullets.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (ctx, i) => Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    margin: const EdgeInsets.only(top: 8),
                    width: 8, height: 8,
                    decoration: const BoxDecoration(
                      color: Colors.white, shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(child: Text(slide.bullets[i],
                    style: const TextStyle(color: Colors.white, fontSize: 18, height: 1.4),
                  )),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
