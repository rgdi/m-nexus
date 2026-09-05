// VaultBrowserPage: lista los archivos del vault de Obsidian, navegando
// entre carpetas. v0.40: primer paso hacia la app standalone.
//
// Permite:
//   - Ver el árbol de carpetas y archivos
//   - Filtrar por tipo (markdown, flashcards, fotos, PDFs)
//   - Abrir un archivo markdown en MarkdownViewer
//   - Ver flashcards en FlashcardsViewer
//   - Crear una nueva nota rápida

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import 'vault_markdown_viewer.dart';
import 'flashcards_viewer.dart';
import '../services/logger.dart';

class VaultBrowserPage extends StatefulWidget {
  /// Ruta raíz del vault (ej: /storage/emulated/0/Documents/MiVault)
  final String vaultPath;

  /// Carpeta inicial (relativa a vaultPath). Default: raíz.
  final String? initialSubdir;

  const VaultBrowserPage({
    super.key,
    required this.vaultPath,
    this.initialSubdir,
  });

  @override
  State<VaultBrowserPage> createState() => _VaultBrowserPageState();
}

class _VaultBrowserPageState extends State<VaultBrowserPage> {
  late String _currentPath;
  List<FileSystemEntity> _entries = [];
  String _filter = '';
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _currentPath = widget.initialSubdir == null
        ? widget.vaultPath
        : p.join(widget.vaultPath, widget.initialSubdir!);
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    final log = AdvancedLogger.instance;
    log.timeStart('vault', 'list_$_currentPath');
    try {
      final dir = Directory(_currentPath);
      if (!await dir.exists()) {
        _error = 'Carpeta no existe: $_currentPath';
        _entries = [];
      } else {
        _entries = await dir.list().toList();
        _entries.sort((a, b) {
          // Carpetas primero, luego archivos, alfabético
          final aIsDir = a is Directory;
          final bIsDir = b is Directory;
          if (aIsDir != bIsDir) return aIsDir ? -1 : 1;
          return p.basename(a.path).toLowerCase().compareTo(p.basename(b.path).toLowerCase());
        });
      }
      log.info('vault', 'Listed directory',
        context: {'path': _currentPath, 'count': _entries.length});
    } catch (e, s) {
      log.error('vault', 'List failed', error: e, stack: s);
      _error = e.toString();
      _entries = [];
    } finally {
      log.timeEnd('vault', 'list_$_currentPath');
    }
    if (!mounted) return;
    setState(() { _loading = false; });
  }

  List<FileSystemEntity> get _filtered {
    if (_filter.isEmpty) return _entries;
    final q = _filter.toLowerCase();
    return _entries.where((e) => p.basename(e.path).toLowerCase().contains(q)).toList();
  }

  String get _relativePath {
    if (_currentPath == widget.vaultPath) return '/';
    return '/' + p.relative(_currentPath, from: widget.vaultPath);
  }

  @override
  Widget build(BuildContext context) {
    final isRoot = _currentPath == widget.vaultPath;
    final folders = _filtered.whereType<Directory>().toList();
    final files = _filtered.whereType<File>().toList();
    final mdxFiles = files.where((f) => p.extension(f.path) == '.md').toList();
    final flashcards = files.where((f) =>
      p.basename(f.path).startsWith('flashcard_') ||
      p.basename(f.path).endsWith('.apkg') ||
      _currentPath.contains('Flashcards')
    ).toList();

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Vault', style: TextStyle(fontSize: 16)),
            Text(
              _relativePath,
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.normal),
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
        actions: [
          if (!isRoot)
            IconButton(
              icon: const Icon(Icons.home, size: 20),
              tooltip: 'Raíz',
              onPressed: () {
                setState(() => _currentPath = widget.vaultPath);
                _load();
              },
            ),
          if (flashcards.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.style, size: 20),
              tooltip: 'Ver flashcards',
              onPressed: () => _openFlashcards(flashcards.first.path),
            ),
          IconButton(
            icon: const Icon(Icons.refresh, size: 20),
            onPressed: _load,
          ),
        ],
      ),
      body: Column(
        children: [
          // Filtro
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            child: TextField(
              decoration: InputDecoration(
                hintText: 'Filtrar...',
                prefixIcon: const Icon(Icons.search, size: 20),
                isDense: true,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(20),
                ),
              ),
              onChanged: (v) => setState(() => _filter = v),
            ),
          ),
          // Stats
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
            child: Row(
              children: [
                _StatChip(icon: Icons.folder, label: 'Carpetas', count: folders.length),
                const SizedBox(width: 8),
                _StatChip(icon: Icons.description, label: 'MD', count: mdxFiles.length),
                const SizedBox(width: 8),
                _StatChip(icon: Icons.image, label: 'Otros', count: files.length - mdxFiles.length),
              ],
            ),
          ),
          const Divider(height: 1),
          // Lista
          if (_loading)
            const Expanded(child: Center(child: CircularProgressIndicator()))
          else if (_error != null)
            Expanded(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.error_outline, color: Colors.red, size: 48),
                      const SizedBox(height: 8),
                      Text(_error!, textAlign: TextAlign.center,
                        style: const TextStyle(color: Colors.red)),
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: _load,
                        icon: const Icon(Icons.refresh, size: 16),
                        label: const Text('Reintentar'),
                      ),
                    ],
                  ),
                ),
              ),
            )
          else if (folders.isEmpty && files.isEmpty)
            Expanded(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.folder_open, size: 48, color: Colors.grey.shade400),
                    const SizedBox(height: 8),
                    const Text('Carpeta vacía'),
                  ],
                ),
              ),
            )
          else
            Expanded(
              child: ListView(
                children: [
                  if (!isRoot)
                    ListTile(
                      leading: const Icon(Icons.arrow_upward, color: Colors.blue),
                      title: const Text('..', style: TextStyle(color: Colors.blue)),
                      dense: true,
                      onTap: () {
                        final parent = Directory(_currentPath).parent.path;
                        if (parent.startsWith(widget.vaultPath)) {
                          setState(() => _currentPath = parent);
                          _load();
                        }
                      },
                    ),
                  ...folders.map((d) => _FolderTile(
                    folder: d,
                    onTap: () {
                      setState(() => _currentPath = d.path);
                      _load();
                    },
                    onStats: () => _showFolderStats(d.path),
                  )),
                  ...mdxFiles.map((f) => _MarkdownTile(
                    file: f,
                    onTap: () => _openMarkdown(f.path),
                  )),
                  ...files.where((f) => p.extension(f.path) != '.md').map((f) => _FileTile(file: f)),
                ],
              ),
            ),
        ],
      ),
    );
  }

  void _openMarkdown(String path) async {
    AdvancedLogger.instance.info('vault', 'Open markdown', context: {'path': path});
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => MarkdownViewerPage(
          filePath: path,
          vaultPath: widget.vaultPath,
        ),
      ),
    );
  }

  void _openFlashcards(String path) async {
    AdvancedLogger.instance.info('vault', 'Open flashcards', context: {'path': path});
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => FlashcardsViewerPage(
          vaultPath: widget.vaultPath,
        ),
      ),
    );
  }

  void _showFolderStats(String path) async {
    try {
      final dir = Directory(path);
      final files = await dir.list().toList();
      if (!mounted) return;
      showModalBottomSheet(
        context: context,
        builder: (_) => Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(p.basename(path),
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(height: 8),
              Text('Archivos: ${files.length}'),
              Text('Tamaño: ${_totalSize(files)} KB'),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.close, size: 16),
                label: const Text('Cerrar'),
              ),
            ],
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: $e')),
      );
    }
  }

  String _totalSize(List<FileSystemEntity> files) {
    var bytes = 0;
    for (final f in files) {
      if (f is File) {
        bytes += f.lengthSync();
      }
    }
    return (bytes / 1024).toStringAsFixed(1);
  }
}

class _StatChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final int count;
  const _StatChip({required this.icon, required this.label, required this.count});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.blue.shade50,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: Colors.blue),
          const SizedBox(width: 4),
          Text('$label: $count', style: const TextStyle(fontSize: 12, color: Colors.blue)),
        ],
      ),
    );
  }
}

class _FolderTile extends StatelessWidget {
  final Directory folder;
  final VoidCallback onTap;
  final VoidCallback onStats;
  const _FolderTile({required this.folder, required this.onTap, required this.onStats});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: const Icon(Icons.folder, color: Colors.amber),
      title: Text(p.basename(folder.path)),
      dense: true,
      onTap: onTap,
      onLongPress: onStats,
    );
  }
}

class _MarkdownTile extends StatelessWidget {
  final File file;
  final VoidCallback onTap;
  const _MarkdownTile({required this.file, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final name = p.basenameWithoutExtension(file.path);
    final size = (file.lengthSync() / 1024).toStringAsFixed(1);
    return ListTile(
      leading: const Icon(Icons.description, color: Colors.blue),
      title: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text('$size KB', style: const TextStyle(fontSize: 11)),
      dense: true,
      onTap: onTap,
    );
  }
}

class _FileTile extends StatelessWidget {
  final File file;
  const _FileTile({required this.file});
  @override
  Widget build(BuildContext context) {
    final ext = p.extension(file.path).toLowerCase();
    final icon = switch (ext) {
      '.png' || '.jpg' || '.jpeg' => Icons.image,
      '.pdf' => Icons.picture_as_pdf,
      '.mp3' || '.m4a' || '.wav' => Icons.audiotrack,
      '.apkg' => Icons.style,
      _ => Icons.insert_drive_file,
    };
    return ListTile(
      leading: Icon(icon, color: Colors.grey),
      title: Text(p.basename(file.path), maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: Text('${(file.lengthSync() / 1024).toStringAsFixed(1)} KB',
        style: const TextStyle(fontSize: 11)),
      dense: true,
    );
  }
}
