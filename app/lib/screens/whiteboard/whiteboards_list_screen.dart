// whiteboards_list_screen.dart: lista de whiteboards guardados.

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import 'whiteboard_screen.dart';

class WhiteboardsListScreen extends StatefulWidget {
  final String vaultPath;
  const WhiteboardsListScreen({super.key, required this.vaultPath});

  @override
  State<WhiteboardsListScreen> createState() => _WhiteboardsListScreenState();
}

class _WhiteboardsListScreenState extends State<WhiteboardsListScreen> {
  List<FileSystemEntity> _files = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final dir = Directory(p.join(widget.vaultPath, 'Whiteboards'));
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }
    final files = dir.listSync().whereType<File>().where((f) => f.path.endsWith('.json')).toList()
      ..sort((a, b) => b.path.compareTo(a.path));
    if (!mounted) return;
    setState(() {
      _files = files;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Whiteboards'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          await Navigator.push(context, MaterialPageRoute(
            builder: (_) => WhiteboardScreen(vaultPath: widget.vaultPath),
          ));
          _load();
        },
        icon: const Icon(Icons.add),
        label: const Text('Nuevo'),
      ),
      body: _loading
        ? const Center(child: CircularProgressIndicator())
        : _files.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  'Sin whiteboards todavia.\nCrea uno para empezar a mapear ideas.',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
            )
          : ListView.separated(
              itemCount: _files.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (ctx, i) {
                final f = _files[i];
                return ListTile(
                  leading: Container(
                    width: 44, height: 44,
                    decoration: BoxDecoration(
                      color: Colors.amber.shade100,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Icon(Icons.account_tree, color: Colors.amber),
                  ),
                  title: Text(p.basenameWithoutExtension(f.path)),
                  subtitle: Text('Modificado: ${_formatDate(File(f.path).statSync().modified)}'),
                  onTap: () async {
                    final wbId = p.basenameWithoutExtension(f.path);
                    await Navigator.push(context, MaterialPageRoute(
                      builder: (_) => WhiteboardScreen(
                        vaultPath: widget.vaultPath,
                        whiteboardId: wbId,
                      ),
                    ));
                    _load();
                  },
                );
              },
            ),
    );
  }

  String _formatDate(DateTime d) {
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')} '
      '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }
}
