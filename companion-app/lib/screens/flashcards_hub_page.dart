// FlashcardsHubPage: hub para elegir vault y abrir flashcards.

import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import '../models/vault_info.dart';
import '../services/vault_detector.dart';
import 'flashcards_viewer.dart';

class FlashcardsHubPage extends StatefulWidget {
  const FlashcardsHubPage({super.key});

  @override
  State<FlashcardsHubPage> createState() => _FlashcardsHubPageState();
}

class _FlashcardsHubPageState extends State<FlashcardsHubPage> {
  final _detector = VaultDetector();
  List<VaultInfo> _vaults = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; });
    final vaults = await _detector.detectVaults();
    if (!mounted) return;
    setState(() {
      _vaults = vaults;
      _loading = false;
    });
  }

  Future<int> _countFlashcards(VaultInfo v) async {
    final dir = Directory(p.join(v.path, '_M-NEXUS', 'Flashcards', 'Approved'));
    if (!await dir.exists()) return 0;
    var count = 0;
    await for (final f in dir.list()) {
      if (f is File && p.extension(f.path) == '.md') count++;
    }
    return count;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Flashcards')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _vaults.isEmpty
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.style, size: 64, color: Colors.grey),
                      const SizedBox(height: 16),
                      const Text('No se detectaron vaults'),
                    ],
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    for (final v in _vaults) FutureBuilder<int>(
                      future: _countFlashcards(v),
                      builder: (ctx, snap) {
                        final count = snap.data ?? 0;
                        return Card(
                          child: ListTile(
                            leading: CircleAvatar(
                              backgroundColor: count > 0
                                  ? Colors.orange.shade100
                                  : Theme.of(context).colorScheme.surfaceContainerHighest,
                              child: Icon(
                                Icons.style,
                                color: count > 0 ? Colors.orange : null,
                              ),
                            ),
                            title: Text(v.name),
                            subtitle: Text('$count flashcards',
                              style: const TextStyle(fontSize: 11)),
                            trailing: const Icon(Icons.arrow_forward_ios, size: 14),
                            onTap: count == 0
                                ? null
                                : () => Navigator.push(
                                    context,
                                    MaterialPageRoute(
                                      builder: (_) => FlashcardsViewerPage(vaultPath: v.path),
                                    ),
                                  ),
                          ),
                        );
                      },
                    ),
                  ],
                ),
    );
  }
}
