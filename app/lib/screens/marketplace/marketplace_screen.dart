// marketplace_screen.dart: lista de decks compartidos (Fase 5.C.2).
//
// v0.46: muestra decks del MarketplaceService backend.
//   - Lista con thumbnail, titulo, autor, downloads
//   - Filtros: categoria, idioma, ordenar por
//   - Buscador
//   - Boton install con download progress
//   - Tap → DeckDetailScreen (v0.46.1 fix)

import 'package:flutter/material.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import '../../services/marketplace_client.dart';
import '../../models/marketplace_deck.dart';
import 'deck_detail_screen.dart';

class MarketplaceScreen extends StatefulWidget {
  final String backendUrl;
  final String? authToken;
  const MarketplaceScreen({super.key, required this.backendUrl, this.authToken});

  @override
  State<MarketplaceScreen> createState() => _MarketplaceScreenState();
}

class _MarketplaceScreenState extends State<MarketplaceScreen> {
  final TextEditingController _searchController = TextEditingController();
  late final MarketplaceClient _client;
  late Future<List<MarketplaceDeck>> _decksFuture;
  String _selectedCategory = 'all';
  String _selectedSort = 'popular';

  @override
  void initState() {
    super.initState();
    _client = MarketplaceClient(
      backendUrl: widget.backendUrl,
      authToken: widget.authToken,
    );
    _decksFuture = _load();
  }

  @override
  void dispose() {
    _searchController.dispose();
    _client.close();
    super.dispose();
  }

  Future<List<MarketplaceDeck>> _load() async {
    return _client.list(
      category: _selectedCategory != 'all' ? _selectedCategory : null,
      sort: _selectedSort,
      search: _searchController.text.trim().isNotEmpty
          ? _searchController.text.trim()
          : null,
    );
  }

  void _refresh() {
    setState(() {
      _decksFuture = _load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.marketplaceTitle),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _refresh,
          ),
        ],
      ),
      body: Column(
        children: [
          // Search + filters
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              children: [
                TextField(
                  controller: _searchController,
                  decoration: InputDecoration(
                    hintText: 'Buscar deck...',
                    prefixIcon: const Icon(Icons.search),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    suffixIcon: _searchController.text.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear),
                            onPressed: () {
                              _searchController.clear();
                              _refresh();
                            },
                          )
                        : null,
                  ),
                  onSubmitted: (_) => _refresh(),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        value: _selectedCategory,
                        decoration: const InputDecoration(
                          labelText: 'Categoría',
                          border: OutlineInputBorder(),
                          isDense: true,
                        ),
                        items: const [
                          DropdownMenuItem(value: 'all', child: Text('Todas')),
                          DropdownMenuItem(value: 'anatomy', child: Text('Anatomía')),
                          DropdownMenuItem(value: 'pharmacology', child: Text('Farmacología')),
                          DropdownMenuItem(value: 'physiology', child: Text('Fisiología')),
                          DropdownMenuItem(value: 'pathology', child: Text('Patología')),
                          DropdownMenuItem(value: 'cardiology', child: Text('Cardiología')),
                          DropdownMenuItem(value: 'neurology', child: Text('Neurología')),
                        ],
                        onChanged: (v) {
                          setState(() => _selectedCategory = v ?? 'all');
                          _refresh();
                        },
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        value: _selectedSort,
                        decoration: const InputDecoration(
                          labelText: 'Ordenar',
                          border: OutlineInputBorder(),
                          isDense: true,
                        ),
                        items: const [
                          DropdownMenuItem(value: 'popular', child: Text('Populares')),
                          DropdownMenuItem(value: 'recent', child: Text('Recientes')),
                          DropdownMenuItem(value: 'rating', child: Text('Mejor valorados')),
                          DropdownMenuItem(value: 'downloads', child: Text('Más descargados')),
                        ],
                        onChanged: (v) {
                          setState(() => _selectedSort = v ?? 'popular');
                          _refresh();
                        },
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),

          // Decks list
          Expanded(
            child: FutureBuilder<List<MarketplaceDeck>>(
              future: _decksFuture,
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snapshot.hasError) {
                  return Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.error_outline, size: 64, color: theme.disabledColor),
                        const SizedBox(height: 12),
                        Text('Error: ${snapshot.error}', textAlign: TextAlign.center),
                        const SizedBox(height: 12),
                        FilledButton(onPressed: _refresh, child: const Text('Reintentar')),
                      ],
                    ),
                  );
                }
                final decks = snapshot.data ?? [];
                if (decks.isEmpty) {
                  return Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.inventory_2_outlined, size: 64, color: theme.disabledColor),
                        const SizedBox(height: 12),
                        const Text('No hay decks disponibles'),
                      ],
                    ),
                  );
                }
                return RefreshIndicator(
                  onRefresh: () async => _refresh(),
                  child: ListView.builder(
                    itemCount: decks.length,
                    itemBuilder: (context, index) {
                      return _DeckTile(
                        deck: decks[index],
                        theme: theme,
                        onInstall: () => _installDeck(decks[index]),
                        client: _client,
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _installDeck(MarketplaceDeck deck) async {
    // Show progress dialog
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => _InstallProgressDialog(deckName: deck.name),
    );

    try {
      await _client.install(deck.id);
      if (mounted) {
        Navigator.of(context).pop(); // Close dialog
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${deck.name} instalado')),
        );
      }
    } catch (e) {
      if (mounted) {
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e')),
        );
      }
    }
  }
}

class _DeckTile extends StatelessWidget {
  final MarketplaceDeck deck;
  final ThemeData theme;
  final VoidCallback onInstall;
  final MarketplaceClient client;
  const _DeckTile({
    required this.deck,
    required this.theme,
    required this.onInstall,
    required this.client,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: theme.colorScheme.primaryContainer,
          child: Text(
            deck.iconEmoji ?? '📚',
            style: const TextStyle(fontSize: 20),
          ),
        ),
        title: Text(deck.name, style: theme.textTheme.titleMedium),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              deck.description,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 4),
            Row(
              children: [
                Icon(Icons.person, size: 12, color: theme.disabledColor),
                const SizedBox(width: 2),
                Text(deck.author, style: theme.textTheme.bodySmall),
                const SizedBox(width: 12),
                Icon(Icons.style, size: 12, color: theme.disabledColor),
                const SizedBox(width: 2),
                Text('${deck.cardCount} cards', style: theme.textTheme.bodySmall),
                const SizedBox(width: 12),
                Icon(Icons.download, size: 12, color: theme.disabledColor),
                const SizedBox(width: 2),
                Text('${deck.downloads}', style: theme.textTheme.bodySmall),
                const SizedBox(width: 12),
                Icon(Icons.star, size: 12, color: Colors.amber),
                const SizedBox(width: 2),
                Text(deck.rating.toStringAsFixed(1), style: theme.textTheme.bodySmall),
              ],
            ),
          ],
        ),
        trailing: FilledButton.tonalIcon(
          icon: const Icon(Icons.download, size: 16),
          label: const Text('Install'),
          onPressed: onInstall,
        ),
        onTap: () {
          // Open detail screen (v0.46.1 fix — antes era callback vacío)
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => DeckDetailScreen(
                deck: deck,
                client: client,
              ),
            ),
          );
        },
      ),
    );
  }
}

class _InstallProgressDialog extends StatelessWidget {
  final String deckName;
  const _InstallProgressDialog({required this.deckName});

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 16),
          Text('Instalando $deckName...'),
        ],
      ),
    );
  }
}
