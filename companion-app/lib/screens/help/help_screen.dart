// HelpScreen: documentación inline.

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

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
            icon: Icons.bolt,
            title: 'Atajos de teclado',
            body: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: const [
                _Kbd('Ctrl+1', 'Ir a Inicio'),
                _Kbd('Ctrl+2', 'Ir a Vault'),
                _Kbd('Ctrl+3', 'Ir a Tarjetas'),
                _Kbd('Ctrl+4', 'Ir a Ajustes'),
                Divider(height: 24),
                _Kbd('Ctrl+N', 'Nueva nota'),
                _Kbd('Ctrl+S', 'Guardar'),
                _Kbd('Ctrl+E', 'Toggle preview'),
                _Kbd('Ctrl+B', 'Bold'),
                _Kbd('Ctrl+I', 'Italic'),
              ],
            ),
          ),
          _Section(
            icon: Icons.info_outline,
            title: '¿Qué es M-NEXUS?',
            body: const Text(
              'Tu segundo cerebro digital. Notas, flashcards, calendar y más — '
              'todo en una sola app, accesible desde Android, Web y Desktop.',
            ),
          ),
          _Section(
            icon: Icons.book,
            title: 'Documentación',
            body: const Text('github.com/rgdi/m-nexus'),
            onTap: () => launchUrl(Uri.parse('https://github.com/rgdi/m-nexus')),
          ),
          _Section(
            icon: Icons.bug_report,
            title: '¿Encontraste un bug?',
            body: const Text('github.com/rgdi/m-nexus/issues'),
            onTap: () => launchUrl(Uri.parse('https://github.com/rgdi/m-nexus/issues')),
          ),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  final IconData icon;
  final String title;
  final Widget body;
  final VoidCallback? onTap;
  const _Section({
    required this.icon,
    required this.title,
    required this.body,
    this.onTap,
  });
  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: onTap,
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
              body,
            ],
          ),
        ),
      ),
    );
  }
}

class _Kbd extends StatelessWidget {
  final String combo;
  final String description;
  const _Kbd(this.combo, this.description);
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(4),
              border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
            ),
            child: Text(combo,
              style: const TextStyle(fontSize: 11, fontFamily: 'monospace')),
          ),
          const SizedBox(width: 12),
          Expanded(child: Text(description,
            style: Theme.of(context).textTheme.bodySmall)),
        ],
      ),
    );
  }
}
