// deck_detail_screen.dart: detail view de un deck del marketplace (Fase 5.C.3).
//
// v0.46: muestra toda la info del deck, sample cards, install flow completo.

import 'package:flutter/material.dart';
import '../../l10n/app_localizations.dart';
import '../../models/marketplace_deck.dart';
import '../../services/marketplace_client.dart';

class DeckDetailScreen extends StatefulWidget {
  final MarketplaceDeck deck;
  final MarketplaceClient client;
  const DeckDetailScreen({super.key, required this.deck, required this.client});

  @override
  State<DeckDetailScreen> createState() => _DeckDetailScreenState();
}

class _DeckDetailScreenState extends State<DeckDetailScreen> {
  bool _isInstalling = false;
  bool _isInstalled = false;
  String? _installError;

  Future<void> _install() async {
    if (_isInstalling || _isInstalled) return;
    setState(() {
      _isInstalling = true;
      _installError = null;
    });
    try {
      await widget.client.install(widget.deck.id);
      if (!mounted) return;
      setState(() {
        _isInstalling = false;
        _isInstalled = true;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('${widget.deck.name} instalado'),
          action: SnackBarAction(
            label: 'Ver',
            onPressed: () {
              Navigator.of(context).pop(widget.deck.id);
            },
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isInstalling = false;
        _installError = e.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final deck = widget.deck;

    return Scaffold(
      appBar: AppBar(
        title: Text(deck.name),
        actions: [
          IconButton(
            icon: const Icon(Icons.share),
            tooltip: 'Share',
            onPressed: () {
              // TODO: share intent
            },
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header con thumbnail
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 80, height: 80,
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Center(
                    child: Text(
                      deck.iconEmoji ?? '📚',
                      style: const TextStyle(fontSize: 40),
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(deck.name, style: theme.textTheme.headlineSmall),
                      const SizedBox(height: 4),
                      Text(
                        'by ${deck.author}',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        children: [
                          _chip(theme, deck.category, Icons.category, Colors.blue),
                          _chip(theme, deck.language, Icons.language, Colors.purple),
                          _chip(theme, '${deck.cardCount} cards', Icons.style, Colors.green),
                          _chip(theme, deck.rating.toStringAsFixed(1), Icons.star, Colors.amber),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),

            const SizedBox(height: 24),

            // Descripción
            Text('Description', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(deck.description, style: theme.textTheme.bodyMedium),

            const SizedBox(height: 24),

            // Stats
            Row(
              children: [
                Expanded(child: _statBox(
                  label: 'Downloads',
                  value: deck.downloads.toString(),
                  icon: Icons.download,
                )),
                const SizedBox(width: 8),
                Expanded(child: _statBox(
                  label: 'Rating',
                  value: deck.rating.toStringAsFixed(1),
                  icon: Icons.star,
                )),
                const SizedBox(width: 8),
                Expanded(child: _statBox(
                  label: 'Updated',
                  value: _formatDate(deck.updatedAt),
                  icon: Icons.update,
                )),
              ],
            ),

            const SizedBox(height: 24),

            // Sample cards preview (placeholder, en real impl vendría del backend)
            Text('Sample cards', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            _buildSampleCard(theme, 'Card 1', 'Front: pregunta 1', 'Back: respuesta 1'),
            const SizedBox(height: 8),
            _buildSampleCard(theme, 'Card 2', 'Front: pregunta 2', 'Back: respuesta 2'),
            const SizedBox(height: 8),
            _buildSampleCard(theme, 'Card 3', 'Front: pregunta 3', 'Back: respuesta 3'),

            const SizedBox(height: 24),

            if (_installError != null) ...[
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: theme.colorScheme.errorContainer,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  'Error: $_installError',
                  style: TextStyle(color: theme.colorScheme.onErrorContainer),
                ),
              ),
              const SizedBox(height: 12),
            ],
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: FilledButton.icon(
            onPressed: _isInstalling || _isInstalled ? null : _install,
            icon: _isInstalling
                ? const SizedBox(
                    width: 16, height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : Icon(_isInstalled ? Icons.check : Icons.download),
            label: Text(_isInstalled ? 'Installed' : (_isInstalling ? 'Installing…' : 'Install deck')),
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(48),
            ),
          ),
        ),
      ),
    );
  }

  Widget _chip(ThemeData theme, String label, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }

  Widget _statBox({required String label, required String value, required IconData icon}) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        children: [
          Icon(icon, size: 20),
          const SizedBox(height: 4),
          Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          Text(label, style: const TextStyle(fontSize: 11, color: Colors.grey)),
        ],
      ),
    );
  }

  Widget _buildSampleCard(ThemeData theme, String title, String front, String back) {
    return Card(
      child: ExpansionTile(
        title: Text(title, style: theme.textTheme.titleSmall),
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Front: $front'),
                const Divider(),
                Text('Back: $back'),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _formatDate(DateTime d) {
    final now = DateTime.now();
    final diff = now.difference(d);
    if (diff.inDays < 1) return 'today';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    if (diff.inDays < 30) return '${(diff.inDays / 7).floor()}w ago';
    return '${(diff.inDays / 30).floor()}mo ago';
  }
}
