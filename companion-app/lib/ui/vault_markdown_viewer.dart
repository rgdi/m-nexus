// MarkdownViewerPage: renderiza un archivo markdown del vault con
// flutter_markdown. Muestra frontmatter como tabla, soporta tap-to-toggle
// en links internos. v0.40 standalone.

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:path/path.dart' as p;
import 'services/logger.dart';
import 'vault_browser_page.dart';

class MarkdownViewerPage extends StatefulWidget {
  final String filePath;
  final String vaultPath;
  const MarkdownViewerPage({
    super.key,
    required this.filePath,
    required this.vaultPath,
  });

  @override
  State<MarkdownViewerPage> createState() => _MarkdownViewerPageState();
}

class _MarkdownViewerPageState extends State<MarkdownViewerPage> {
  String _content = '';
  Map<String, String> _frontmatter = {};
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final log = AdvancedLogger.instance;
    log.timeStart('md', 'load_${widget.filePath}');
    try {
      final file = File(widget.filePath);
      if (!await file.exists()) {
        _error = 'Archivo no existe';
      } else {
        final raw = await file.readAsString();
        // Parsear frontmatter
        final parsed = _parseFrontmatter(raw);
        _content = parsed.content;
        _frontmatter = parsed.frontmatter;
      }
      log.info('md', 'Loaded markdown',
        context: {'path': widget.filePath, 'len': _content.length, 'hasFrontmatter': _frontmatter.isNotEmpty});
    } catch (e, s) {
      log.error('md', 'Load failed', error: e, stack: s);
      _error = e.toString();
    } finally {
      log.timeEnd('md', 'load_${widget.filePath}');
    }
    if (!mounted) return;
    setState(() { _loading = false; });
  }

  /// Parsea YAML frontmatter simple: ---\nkey: value\n---
  _MdParsed _parseFrontmatter(String raw) {
    if (!raw.startsWith('---')) return _MdParsed(content: raw, frontmatter: const {});
    final lines = raw.split('\n');
    if (lines.length < 3) return _MdParsed(content: raw, frontmatter: const {});
    if (lines[0].trim() != '---') return _MdParsed(content: raw, frontmatter: const {});

    final endIdx = lines.indexWhere((l) => l.trim() == '---', 1);
    if (endIdx == -1) return _MdParsed(content: raw, frontmatter: const {});

    final fmLines = lines.sublist(1, endIdx);
    final body = lines.sublist(endIdx + 1).join('\n');
    final fm = <String, String>{};
    for (final line in fmLines) {
      final m = RegExp(r'^(\w+)\s*:\s*(.*)$').firstMatch(line.trim());
      if (m != null) {
        fm[m.group(1)!] = m.group(2)!.trim();
      }
    }
    return _MdParsed(content: body, frontmatter: fm);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(p.basename(widget.filePath), overflow: TextOverflow.ellipsis),
        actions: [
          IconButton(
            icon: const Icon(Icons.copy, size: 20),
            tooltip: 'Copiar texto',
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: _content));
              if (!mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Markdown copiado al portapapeles')),
              );
            },
          ),
          IconButton(
            icon: const Icon(Icons.refresh, size: 20),
            onPressed: () {
              setState(() { _loading = true; _error = null; });
              _load();
            },
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.error_outline, color: Colors.red, size: 48),
                      const SizedBox(height: 8),
                      Text(_error!),
                    ],
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
                  children: [
                    // Frontmatter card (si existe)
                    if (_frontmatter.isNotEmpty) ...[
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.amber.shade50,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: Colors.amber.shade200),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: _frontmatter.entries.map((e) => Padding(
                            padding: const EdgeInsets.symmetric(vertical: 2),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                SizedBox(
                                  width: 100,
                                  child: Text(e.key,
                                    style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12)),
                                ),
                                Expanded(child: Text(e.value, style: const TextStyle(fontSize: 12))),
                              ],
                            ),
                          )).toList(),
                        ),
                      ),
                      const SizedBox(height: 12),
                    ],
                    // Markdown renderizado
                    MarkdownBody(
                      data: _content,
                      onTapLink: (text, href, title) {
                        if (href == null) return;
                        // Links internos: [[Nota]] o .md
                        if (href.endsWith('.md') || !href.contains('://')) {
                          final newPath = _resolveInternalLink(href);
                          if (newPath != null) {
                            Navigator.pushReplacement(
                              context,
                              MaterialPageRoute(
                                builder: (_) => MarkdownViewerPage(
                                  filePath: newPath,
                                  vaultPath: widget.vaultPath,
                                ),
                              ),
                            );
                            return;
                          }
                        }
                        // Links externos: no abrimos (sin browser en el companion)
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Link: $href')),
                        );
                      },
                    ),
                  ],
                ),
    );
  }

  String? _resolveInternalLink(String href) {
    // Quitar #anchors
    final clean = href.split('#').first;
    if (clean.isEmpty) return null;
    final dir = p.dirname(widget.filePath);
    var resolved = p.isAbsolute(clean) ? clean : p.join(dir, clean);
    if (!resolved.endsWith('.md')) resolved += '.md';
    if (File(resolved).existsSync()) return resolved;
    // Probar desde la raíz del vault
    if (!p.isAbsolute(clean)) {
      resolved = p.join(widget.vaultPath, clean);
      if (!resolved.endsWith('.md')) resolved += '.md';
      if (File(resolved).existsSync()) return resolved;
    }
    return null;
  }
}

class _MdParsed {
  final String content;
  final Map<String, String> frontmatter;
  const _MdParsed({required this.content, required this.frontmatter});
}
