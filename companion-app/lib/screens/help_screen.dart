// HelpScreen v0.41: pantalla de ayuda simplificada.

import 'package:flutter/material.dart';

class HelpScreen extends StatelessWidget {
  const HelpScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ayuda')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _Section(
            icon: Icons.info_outline,
            title: 'Acerca de M-NEXUS',
            body: 'Tu segundo cerebro digital. Notas, flashcards, calendar y más, '
                'todo en un solo lugar. Funciona en Android y Web.',
          ),
          _Section(
            icon: Icons.help_outline,
            title: '¿Cómo empezar?',
            body: '1. Detectá tu vault (carpeta con `.obsidian/`)\n'
                '2. Explorá las notas\n'
                '3. Repasá las flashcards\n'
                '4. Conectá un calendario (Android)',
          ),
          _Section(
            icon: Icons.book_outlined,
            title: 'Documentación',
            body: 'https://github.com/rgdi/m-nexus',
          ),
          _Section(
            icon: Icons.bug_report_outlined,
            title: '¿Encontraste un bug?',
            body: 'https://github.com/rgdi/m-nexus/issues',
          ),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  final IconData icon;
  final String title;
  final String body;
  const _Section({required this.icon, required this.title, required this.body});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, color: Theme.of(context).colorScheme.primary),
                const SizedBox(width: 8),
                Text(title,
                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
              ],
            ),
            const SizedBox(height: 8),
            Text(body, style: const TextStyle(height: 1.5)),
          ],
        ),
      ),
    );
  }
}
