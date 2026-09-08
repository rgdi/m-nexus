// onboarding_tutorial.dart: 3 slides de bienvenida post-setup.
//
// v0.47.0: tutorial corto para nuevos usuarios, en español de España.

import 'package:flutter/material.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';

class OnboardingTutorial extends StatefulWidget {
  final VoidCallback onFinish;
  const OnboardingTutorial({super.key, required this.onFinish});

  @override
  State<OnboardingTutorial> createState() => _OnboardingTutorialState();
}

class _OnboardingTutorialState extends State<OnboardingTutorial> {
  final _pageController = PageController();
  int _index = 0;

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  static const _slides = <_SlideData>[
    _SlideData(
      icon: Icons.note_add_outlined,
      title: 'Notas en Markdown',
      body: 'Tus notas viven como archivos .md en tu vault. Usa [[wikilinks]] para conectar ideas y #tags para organizarlas.',
      accent: 0xFF4F6BED,
    ),
    _SlideData(
      icon: Icons.style_outlined,
      title: 'Tarjetas con FSRS',
      body: 'Crea flashcards con {{c1::cloze}}, básicas o de imagen. La dificultad se ajusta sola: cada vez aciertas, la tarjeta aparece más tarde.',
      accent: 0xFF8B5CF6,
    ),
    _SlideData(
      icon: Icons.bolt_outlined,
      title: 'Tu ritmo, tu progreso',
      body: 'El heatmap muestra tu racha diaria, las predicciones del algoritmo te dicen qué repasar hoy, y tú solo decides cuánto.',
      accent: 0xFF10B981,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            // Skip
            Align(
              alignment: Alignment.topRight,
              child: TextButton(
                onPressed: widget.onFinish,
                child: const Text('Saltar'),
              ),
            ),
            // Slides
            Expanded(
              child: PageView.builder(
                controller: _pageController,
                itemCount: _slides.length,
                onPageChanged: (i) => setState(() => _index = i),
                itemBuilder: (context, i) {
                  final s = _slides[i];
                  return Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 32),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          width: 140, height: 140,
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                              colors: [
                                Color(s.accent),
                                Color(s.accent).withOpacity(0.7),
                              ],
                            ),
                            borderRadius: BorderRadius.circular(36),
                            boxShadow: [
                              BoxShadow(
                                color: Color(s.accent).withOpacity(0.4),
                                blurRadius: 24,
                                offset: const Offset(0, 12),
                              ),
                            ],
                          ),
                          child: Icon(s.icon, size: 72, color: Colors.white),
                        ),
                        const SizedBox(height: 40),
                        Text(
                          s.title,
                          style: theme.textTheme.headlineMedium?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 16),
                        Text(
                          s.body,
                          style: theme.textTheme.bodyLarge?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                            height: 1.5,
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
            // Indicators
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(_slides.length, (i) {
                final active = i == _index;
                return Container(
                  margin: const EdgeInsets.symmetric(horizontal: 4),
                  width: active ? 24 : 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: active
                        ? theme.colorScheme.primary
                        : theme.colorScheme.surfaceContainerHigh,
                    borderRadius: BorderRadius.circular(4),
                  ),
                );
              }),
            ),
            const SizedBox(height: 24),
            // Next
            Padding(
              padding: const EdgeInsets.all(20),
              child: FilledButton(
                onPressed: () {
                  if (_index < _slides.length - 1) {
                    _pageController.nextPage(
                      duration: const Duration(milliseconds: 300),
                      curve: Curves.easeOutCubic,
                    );
                  } else {
                    widget.onFinish();
                  }
                },
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(52),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                child: Text(_index < _slides.length - 1 ? 'Siguiente' : 'Empezar'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SlideData {
  final IconData icon;
  final String title;
  final String body;
  final int accent;
  const _SlideData({
    required this.icon,
    required this.title,
    required this.body,
    required this.accent,
  });
}
